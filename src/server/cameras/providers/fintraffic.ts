import type { Camera } from "@/types/cameras";

export const FINTRAFFIC_API = "https://tie.digitraffic.fi/api/weathercam/v1/stations";
export const FINTRAFFIC_DATA = `${FINTRAFFIC_API}/data`;
export const FINTRAFFIC_ATTRIBUTION = "Fintraffic / Digitraffic";
export const FINTRAFFIC_LICENSE = "CC BY 4.0";
const ID = /^C\d{5,12}$/;
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const string = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const iso = (value: unknown): string | null => {
  const raw = string(value);
  const time = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

export function assertFintrafficUrl(raw: string, kind: "api" | "image"): URL {
  const url = new URL(raw);
  const host = kind === "api" ? "tie.digitraffic.fi" : "weathercam.digitraffic.fi";
  if (url.protocol !== "https:" || url.hostname !== host || url.port || url.username || url.password || url.hash ||
    (kind === "api" && (!/^\/api\/weathercam\/v1\/stations(?:\/data|\/C\d{5,12})?$/.test(url.pathname) || url.search)) ||
    (kind === "image" && (!/^\/C\d{5,12}\.jpg$/.test(url.pathname) || url.search))) throw new Error("Fintraffic URL rejected");
  return url;
}

export async function fetchFintraffic(url: string, kind: "api" | "image", fetcher: typeof fetch = fetch, maxBytes = kind === "image" ? 4_000_000 : 8_000_000): Promise<Uint8Array> {
  assertFintrafficUrl(url, kind);
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(10_000), redirect: "manual", cache: "no-store",
    headers: { "Digitraffic-User": "ORBITAL/1.0", Accept: kind === "image" ? "image/jpeg" : "application/json", ...(kind === "api" ? { "Accept-Encoding": "gzip" } : {}) },
  });
  if (!response.ok) throw new Error(`Fintraffic HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== (kind === "image" ? "image/jpeg" : "application/json")) throw new Error("Fintraffic Content-Type rejected");
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) throw new Error("Fintraffic response too large");
  if (!response.body) throw new Error("Fintraffic empty response");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Error("Fintraffic response too large");
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}

export async function fetchFintrafficJson(url: string, fetcher: typeof fetch = fetch): Promise<unknown> {
  const bytes = await fetchFintraffic(url, "api", fetcher);
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
  catch { throw new Error("Fintraffic invalid JSON"); }
}

export function cameraStatus(capturedAt: string | null, inCollection: boolean, now: number): Camera["status"] {
  if (!inCollection) return "offline";
  if (!capturedAt) return "offline";
  const age = now - Date.parse(capturedAt);
  if (age < -5 * 60_000) return "error";
  if (age <= 30 * 60_000) return "recent"; // imagery normally changes about every 10 minutes
  if (age <= 24 * 60 * 60_000) return "stale";
  return "offline"; // Digitraffic keeps images for about 24 hours
}

export function parseFintraffic(stationsRaw: unknown, dataRaw: unknown, fetchedAt: string): Camera[] {
  const stations = object(stationsRaw);
  const data = object(dataRaw);
  if (stations?.type !== "FeatureCollection" || !Array.isArray(stations.features) || stations.features.length === 0 || !data || !Array.isArray(data.stations) || data.stations.length === 0) throw new Error("Fintraffic invalid catalog response");
  const measured = new Map<string, string>();
  for (const row of data.stations) {
    const presets = object(row)?.presets;
    if (!Array.isArray(presets)) continue;
    for (const value of presets) {
      const preset = object(value);
      const id = string(preset?.id);
      const time = iso(preset?.measuredTime);
      if (id && time) measured.set(id, time);
    }
  }
  const cameras: Camera[] = [];
  const seen = new Set<string>();
  const now = Date.parse(fetchedAt);
  for (const value of stations.features) {
    const feature = object(value);
    const props = object(feature?.properties);
    const geometry = object(feature?.geometry);
    const coords = geometry?.coordinates;
    const stationId = string(props?.id);
    if (!props || !stationId || !ID.test(stationId) || geometry?.type !== "Point" || !Array.isArray(coords) || coords.length < 2) continue;
    const [longitude, latitude] = coords;
    if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) continue;
    const presets = props.presets;
    if (!Array.isArray(presets)) continue;
    for (const value of presets) {
      const preset = object(value);
      const id = string(preset?.id);
      if (!id || !ID.test(id) || !id.startsWith(stationId) || seen.has(id)) continue;
      seen.add(id);
      const capturedAt = measured.get(id) ?? null;
      const collecting = props.collectionStatus === "GATHERING" && preset?.inCollection === true;
      cameras.push({
        id, providerId: "fintraffic", providerName: FINTRAFFIC_ATTRIBUTION,
        name: string(preset?.presentationName) ?? string(props.name),
        city: string(props.municipality), region: null, country: "Finland", latitude, longitude,
        direction: string(preset?.direction) ?? string(preset?.directionCode), mediaType: "periodic_snapshot",
        streamProtocol: null, streamUrl: null, imageUrl: fintrafficImageUrl(id),
        officialPageUrl: null, providerHomepageUrl: "https://www.digitraffic.fi/en/road-traffic/",
        providerApiUrl: `${FINTRAFFIC_API}/${stationId}`, capturedAt, updatedAt: capturedAt, fetchedAt,
        expectedRefreshSeconds: 600, status: cameraStatus(capturedAt, collecting, now),
        health: collecting ? "ok" : "stale", attribution: FINTRAFFIC_ATTRIBUTION, license: FINTRAFFIC_LICENSE,
      });
    }
  }
  if (stations.features.length > 0 && cameras.length === 0) throw new Error("Fintraffic catalog has no valid cameras");
  return cameras;
}

export function enrichFintrafficCamera(camera: Camera, raw: unknown): Camera {
  const props = object(object(raw)?.properties);
  const presets = props?.presets;
  const preset = Array.isArray(presets) ? presets.map(object).find((row) => row?.id === camera.id) : null;
  if (!preset) return camera;
  return { ...camera, name: string(preset.presentationName) ?? string(object(props?.names)?.en) ?? camera.name, city: string(props?.municipality) ?? camera.city, direction: string(preset.direction) ?? string(preset.directionCode), providerApiUrl: `${FINTRAFFIC_API}/${camera.id.slice(0, -2)}` };
}

export function fintrafficImageUrl(id: string): string {
  if (!ID.test(id)) throw new Error("Invalid camera ID");
  const url = `https://weathercam.digitraffic.fi/${id}.jpg`;
  assertFintrafficUrl(url, "image");
  return url;
}
