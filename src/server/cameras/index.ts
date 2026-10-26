import "server-only";
import type { Camera, CameraCatalogResponse } from "@/types/cameras";
import { getSourceHealth, recordAttempt, registerSource, type SourceDescriptor } from "@/server/health/registry";
import { FINTRAFFIC_API, FINTRAFFIC_DATA, FINTRAFFIC_LICENSE, cameraStatus, enrichFintrafficCamera, fetchFintraffic, fetchFintrafficJson, fintrafficImageUrl, parseFintraffic } from "./providers/fintraffic";

const TTL = 10 * 60_000;
const RETRY = 60_000;
const descriptor: SourceDescriptor = { id: "camera:fintraffic", kind: "camera", name: "Fintraffic / Digitraffic", category: "road-weather-camera", homepage: "https://www.digitraffic.fi/en/road-traffic/", license: FINTRAFFIC_LICENSE, nature: "instantanés routiers périodiques", staleAfterMs: 3 * TTL };
registerSource(descriptor);

type Snapshot = { cameras: Camera[]; fetchedAt: string; checkedAt: number };
const state = globalThis as unknown as { __orbitalFintrafficCameraCache?: { snapshot: Snapshot | null; retryAt: number; inflight: Promise<void> | null; error: string | null } };
const cache = () => (state.__orbitalFintrafficCameraCache ??= { snapshot: null, retryAt: 0, inflight: null, error: null });
const safeError = (error: unknown) => error instanceof Error ? error.message.slice(0, 180) : "Fintraffic unavailable";
const current = (snapshot: Snapshot, now: number) => snapshot.cameras.map((camera) => ({ ...camera, status: camera.status === "offline" ? "offline" as const : cameraStatus(camera.capturedAt, true, now) }));

export async function loadCameras(fetcher: typeof fetch = fetch, now = Date.now()): Promise<CameraCatalogResponse> {
  const c = cache();
  if (c.snapshot && now - c.snapshot.checkedAt < TTL && !c.error) return { cameras: current(c.snapshot, now), total: c.snapshot.cameras.length, status: "ok", message: null, fetchedAt: c.snapshot.fetchedAt };
  if (!c.inflight && now >= c.retryAt) {
    c.inflight = (async () => {
      const start = Date.now();
      try {
        const [stations, data] = await Promise.all([fetchFintrafficJson(FINTRAFFIC_API, fetcher), fetchFintrafficJson(FINTRAFFIC_DATA, fetcher)]);
        const fetchedAt = new Date(Date.now()).toISOString();
        const cameras = parseFintraffic(stations, data, fetchedAt);
        c.snapshot = { cameras, fetchedAt, checkedAt: Date.now() };
        c.error = null;
        c.retryAt = 0;
        const newest = cameras.reduce<string | null>((best, camera) => camera.capturedAt && (!best || camera.capturedAt > best) ? camera.capturedAt : best, null);
        recordAttempt(descriptor, { ok: true, startedAt: start, finishedAt: Date.now(), itemCount: cameras.length, newestDataAt: newest });
      } catch (error) {
        c.error = safeError(error);
        c.retryAt = Date.now() + RETRY;
        recordAttempt(descriptor, { ok: false, startedAt: start, finishedAt: Date.now(), error: c.error, servedItems: c.snapshot?.cameras.length ?? 0 });
      }
    })().finally(() => { c.inflight = null; });
  }
  if (c.inflight) await c.inflight;
  const snapshot = c.snapshot;
  if (!snapshot) return { cameras: [], total: 0, status: "error", message: c.error ?? "Fintraffic unavailable", fetchedAt: null };
  const stale = Boolean(c.error) || now - snapshot.checkedAt >= TTL;
  return { cameras: current(snapshot, now), total: snapshot.cameras.length, status: stale ? "stale" : "ok", message: stale ? c.error ?? "Catalogue en attente d’actualisation" : null, fetchedAt: snapshot.fetchedAt };
}

export function parseCameraQuery(params: URLSearchParams): { bbox: [number, number, number, number] | null; provider: string | null; country: string | null; limit: number } {
  const allowed = new Set(["bbox", "provider", "country", "limit"]);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) throw new Error("Paramètre inconnu ou répété");
  let bbox: [number, number, number, number] | null = null;
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
  if (provider !== null && provider !== "fintraffic") throw new Error("Fournisseur inconnu");
  const country = params.get("country");
  if (country !== null && !/^(FI|Finland)$/i.test(country)) throw new Error("Pays inconnu");
  const rawLimit = params.get("limit");
  if (rawLimit !== null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 2500)) throw new Error("limit invalide");
  return { bbox, provider, country, limit: rawLimit === null ? 500 : Number(rawLimit) };
}

export function filterCameras(catalog: CameraCatalogResponse, query: ReturnType<typeof parseCameraQuery>): CameraCatalogResponse {
  const matching = catalog.cameras.filter((camera) => (!query.provider || camera.providerId === query.provider) && (!query.country || camera.country === "Finland") && (!query.bbox || (camera.longitude >= query.bbox[0] && camera.longitude <= query.bbox[2] && camera.latitude >= query.bbox[1] && camera.latitude <= query.bbox[3])));
  return { ...catalog, total: matching.length, cameras: matching.slice(0, query.limit) };
}

export async function cameraById(id: string, fetcher: typeof fetch = fetch): Promise<Camera | null> {
  if (!/^C\d{5,12}$/.test(id)) return null;
  const catalog = await loadCameras(fetcher);
  const camera = catalog.cameras.find((entry) => entry.id === id);
  if (!camera) return null;
  try { return enrichFintrafficCamera(camera, await fetchFintrafficJson(`${FINTRAFFIC_API}/${id.slice(0, -2)}`, fetcher)); }
  catch { return camera; }
}

export async function cameraFrame(id: string, fetcher: typeof fetch = fetch): Promise<Uint8Array | null> {
  const catalog = await loadCameras(fetcher);
  const camera = catalog.cameras.find((entry) => entry.id === id);
  if (!camera || camera.status === "offline" || camera.status === "error") return null;
  return fetchFintraffic(fintrafficImageUrl(id), "image", fetcher);
}

export function fintrafficHealth() { return getSourceHealth(descriptor.id); }

/** Test isolation only. */
export function resetCameraCache() { state.__orbitalFintrafficCameraCache = undefined; }
