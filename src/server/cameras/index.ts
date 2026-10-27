import "server-only";
import type { Camera, CameraCatalogResponse, CameraMarker, CameraMediaType, CameraStatus } from "@/types/cameras";
import { getSourceHealth, markUnconfigured, recordAttempt, registerSource } from "@/server/health/registry";
import type { CameraProvider } from "./provider";
import { FINTRAFFIC_API, FINTRAFFIC_DATA, FINTRAFFIC_LICENSE, cameraStatus, enrichFintrafficCamera, fetchFintraffic, fetchFintrafficJson, fintrafficImageUrl, parseFintraffic } from "./providers/fintraffic";
import { singaporeProvider, singaporeStatus } from "./providers/singapore";
import { nztaProvider } from "./providers/nzta";
import { hongKongProvider } from "./providers/hongKong";
import { driveBcProvider } from "./providers/driveBc";
import { IBI511_NETWORKS, ibi511Provider } from "./providers/ibi511";

const fintrafficProvider: CameraProvider = {
  id: "fintraffic", ttlMs: 10 * 60_000, retryMs: 60_000, requiredKeyEnv: null,
  descriptor: { id: "camera:fintraffic", kind: "camera", name: "Fintraffic / Digitraffic", category: "road-weather-camera", homepage: "https://www.digitraffic.fi/en/road-traffic/", license: FINTRAFFIC_LICENSE, nature: "instantanés routiers périodiques", staleAfterMs: 30 * 60_000 },
  async fetchCatalog(fetcher) {
    const [stations, data] = await Promise.all([fetchFintrafficJson(FINTRAFFIC_API, fetcher), fetchFintrafficJson(FINTRAFFIC_DATA, fetcher)]);
    return parseFintraffic(stations, data, new Date().toISOString());
  },
  async detail(camera, fetcher) {
    try { return enrichFintrafficCamera(camera, await fetchFintrafficJson(`${FINTRAFFIC_API}/${camera.id.slice(0, -2)}`, fetcher)); }
    catch { return camera; }
  },
  async frame(camera, fetcher) { return fetchFintraffic(fintrafficImageUrl(camera.id), "image", fetcher); },
};

export const cameraProviders: readonly CameraProvider[] = [fintrafficProvider, singaporeProvider, nztaProvider, hongKongProvider, driveBcProvider, ...IBI511_NETWORKS.map(ibi511Provider)];
const byProvider = new Map(cameraProviders.map((provider) => [provider.id, provider]));
for (const provider of cameraProviders) {
  registerSource(provider.descriptor);
  if (provider.requiredKeyEnv && !process.env[provider.requiredKeyEnv]) markUnconfigured(provider.descriptor, `Clé facultative ${provider.requiredKeyEnv} absente`);
}

type Snapshot = { cameras: Camera[]; fetchedAt: string; checkedAt: number };
type ProviderCache = { snapshot: Snapshot | null; retryAt: number; inflight: Promise<void> | null; error: string | null };
const holder = globalThis as unknown as { __orbitalCameraProviderCache?: Map<string, ProviderCache> };
const caches = () => holder.__orbitalCameraProviderCache ??= new Map<string, ProviderCache>();
const cacheFor = (id: string): ProviderCache => {
  const map = caches();
  let entry = map.get(id);
  if (!entry) { entry = { snapshot: null, retryAt: 0, inflight: null, error: null }; map.set(id, entry); }
  return entry;
};
const safeError = (error: unknown) => error instanceof Error ? error.message.replace(/key=[^&\s]+/g, "key=[redacted]").slice(0, 180) : "Camera source unavailable";

async function loadProvider(provider: CameraProvider, fetcher: typeof fetch, now: number): Promise<{ cameras: Camera[]; fetchedAt: string | null; stale: boolean; error: string | null }> {
  const c = cacheFor(provider.id);
  const key = provider.requiredKeyEnv ? process.env[provider.requiredKeyEnv]?.trim() || null : null;
  if (provider.requiredKeyEnv && !key) {
    markUnconfigured(provider.descriptor, `Clé facultative ${provider.requiredKeyEnv} absente`);
    return { cameras: [], fetchedAt: null, stale: false, error: null };
  }
  if ((!c.snapshot || now - c.snapshot.checkedAt >= provider.ttlMs || c.error) && !c.inflight && now >= c.retryAt) {
    c.inflight = (async () => {
      const startedAt = Date.now();
      try {
        const cameras = await provider.fetchCatalog(fetcher, key);
        const fetchedAt = new Date().toISOString();
        c.snapshot = { cameras, fetchedAt, checkedAt: Date.now() };
        c.error = null; c.retryAt = 0;
        const newestDataAt = cameras.reduce<string | null>((best, camera) => camera.capturedAt && (!best || camera.capturedAt > best) ? camera.capturedAt : best, null);
        recordAttempt(provider.descriptor, { ok: true, startedAt, finishedAt: Date.now(), itemCount: cameras.length, newestDataAt });
      } catch (error) {
        c.error = safeError(error); c.retryAt = Date.now() + provider.retryMs;
        recordAttempt(provider.descriptor, { ok: false, startedAt, finishedAt: Date.now(), error: c.error, servedItems: c.snapshot?.cameras.length ?? 0 });
      }
    })().finally(() => { c.inflight = null; });
  }
  if (c.inflight) await c.inflight;
  const snapshot = c.snapshot;
  if (!snapshot) return { cameras: [], fetchedAt: null, stale: true, error: c.error };
  const stale = Boolean(c.error) || now - snapshot.checkedAt >= provider.ttlMs;
  const cameras = snapshot.cameras.map((camera) => ({ ...camera,
    status: provider.id === "fintraffic" ? camera.status === "offline" ? "offline" as const : cameraStatus(camera.capturedAt, true, now)
      : provider.id === "singapore" ? singaporeStatus(camera.capturedAt, now) : camera.status,
    health: stale ? "stale" as const : camera.health,
  }));
  return { cameras, fetchedAt: snapshot.fetchedAt, stale, error: c.error };
}

const marker = ({ streamUrl: _streamUrl, imageUrl: _imageUrl, providerApiUrl: _providerApiUrl, ...camera }: Camera): CameraMarker => camera;
const counts = (cameras: readonly CameraMarker[]) => ({
  liveVideo: cameras.filter((camera) => camera.mediaType === "live_video").length,
  nearLiveImage: cameras.filter((camera) => camera.mediaType === "near_live_image").length,
  periodicSnapshot: cameras.filter((camera) => camera.mediaType === "periodic_snapshot").length,
});

export async function loadCameras(fetcher: typeof fetch = fetch, now = Date.now(), onlyProvider: string | null = null): Promise<CameraCatalogResponse> {
  const providers = onlyProvider ? cameraProviders.filter((provider) => provider.id === onlyProvider) : cameraProviders;
  const results = await Promise.all(providers.map((provider) => loadProvider(provider, fetcher, now)));
  const cameras = results.flatMap((result) => result.cameras.map(marker));
  const errors = results.filter((result) => result.error).map((result) => result.error);
  return {
    cameras, total: cameras.length, counts: counts(cameras),
    status: cameras.length ? errors.length ? "stale" : "ok" : errors.length ? "error" : "ok",
    message: errors.length ? `${errors.length} source(s) caméra indisponible(s) : ${errors.join(" ; ")}` : null,
    fetchedAt: results.map((result) => result.fetchedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
    nextCursor: null,
  };
}

export interface CameraQuery {
  bbox: [number, number, number, number] | null;
  provider: string | null;
  country: string | null;
  mediaType: CameraMediaType | null;
  status: CameraStatus | null;
  liveOnly: boolean;
  limit: number;
  cursor: number;
}

export function parseCameraQuery(params: URLSearchParams): CameraQuery {
  const allowed = new Set(["bbox", "provider", "country", "mediaType", "status", "liveOnly", "limit", "cursor"]);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) throw new Error("Paramètre inconnu ou répété");
  let bbox: CameraQuery["bbox"] = null;
  const raw = params.get("bbox");
  if (raw !== null) {
    const parts = raw.split(",");
    if (parts.length !== 4 || parts.some((part) => !/^-?\d+(?:\.\d+)?$/.test(part))) throw new Error("bbox invalide");
    const values = parts.map(Number) as [number, number, number, number];
    const [west, south, east, north] = values;
    if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) throw new Error("bbox invalide");
    bbox = values;
  }
  const provider = params.get("provider");
  if (provider !== null && !byProvider.has(provider)) throw new Error("Fournisseur inconnu");
  const country = params.get("country");
  if (country !== null && !/^[A-Za-z ]{2,40}$/.test(country)) throw new Error("Pays invalide");
  const mediaType = params.get("mediaType");
  if (mediaType !== null && !["live_video", "near_live_image", "periodic_snapshot"].includes(mediaType)) throw new Error("mediaType invalide");
  const status = params.get("status");
  if (status !== null && !["live", "recent", "stale", "offline", "error", "unknown"].includes(status)) throw new Error("status invalide");
  const liveOnly = params.get("liveOnly");
  if (liveOnly !== null && liveOnly !== "true" && liveOnly !== "false") throw new Error("liveOnly invalide");
  const rawLimit = params.get("limit");
  if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 2500)) throw new Error("limit invalide");
  const rawCursor = params.get("cursor");
  if (rawCursor !== null && (!/^(0|[1-9]\d{0,6})$/.test(rawCursor) || Number(rawCursor) > 1_000_000)) throw new Error("cursor invalide");
  return { bbox, provider, country, mediaType: mediaType as CameraMediaType | null, status: status as CameraStatus | null, liveOnly: liveOnly === "true", limit: rawLimit === null ? 500 : Number(rawLimit), cursor: rawCursor === null ? 0 : Number(rawCursor) };
}

export function filterCameras(catalog: CameraCatalogResponse, query: CameraQuery): CameraCatalogResponse {
  const aliases: Record<string, string> = { FI: "Finland", SG: "Singapore", NZ: "New Zealand", HK: "Hong Kong", US: "United States", CA: "Canada" };
  const country = query.country ? aliases[query.country.toUpperCase()] ?? query.country : null;
  const matching = catalog.cameras.filter((camera) => (!query.provider || camera.providerId === query.provider) && (!country || camera.country?.toLowerCase() === country.toLowerCase()) && (!query.mediaType || camera.mediaType === query.mediaType) && (!query.status || camera.status === query.status) && (!query.liveOnly || camera.mediaType === "live_video") && (!query.bbox || (camera.longitude >= query.bbox[0] && camera.longitude <= query.bbox[2] && camera.latitude >= query.bbox[1] && camera.latitude <= query.bbox[3])));
  const end = query.cursor + query.limit;
  return { ...catalog, total: matching.length, counts: counts(matching), cameras: matching.slice(query.cursor, end), nextCursor: end < matching.length ? String(end) : null };
}

function providerForId(id: string): CameraProvider | null {
  if (/^C\d{5,12}$/.test(id)) return fintrafficProvider;
  const match = id.match(/^([a-z]+):[A-Z0-9]{1,12}$/);
  return match ? byProvider.get(match[1]) ?? null : null;
}

export async function cameraById(id: string, fetcher: typeof fetch = fetch): Promise<Camera | null> {
  const provider = providerForId(id);
  if (!provider) return null;
  await loadProvider(provider, fetcher, Date.now());
  const camera = cacheFor(provider.id).snapshot?.cameras.find((entry) => entry.id === id);
  return camera ? provider.detail ? provider.detail(camera, fetcher) : camera : null;
}

export async function cameraFrame(id: string, fetcher: typeof fetch = fetch): Promise<{ bytes: Uint8Array; cacheSeconds: number } | null> {
  const provider = providerForId(id);
  if (!provider?.frame) return null;
  const camera = await cameraById(id, fetcher);
  if (!camera || camera.status === "offline" || camera.status === "error") return null;
  const bytes = await provider.frame(camera, fetcher);
  // A cached near-live response must expire before the provider's next advertised update.
  const cacheSeconds = camera.expectedRefreshSeconds ? Math.min(60, Math.max(5, Math.floor(camera.expectedRefreshSeconds / 2))) : 60;
  return { bytes, cacheSeconds };
}

export function fintrafficHealth() { return getSourceHealth(fintrafficProvider.descriptor.id); }
/** Test isolation only. */
export function resetCameraCache() { holder.__orbitalCameraProviderCache = undefined; }
