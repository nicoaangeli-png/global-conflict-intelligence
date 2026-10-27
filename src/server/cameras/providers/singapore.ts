import type { Camera, CameraStatus } from "@/types/cameras";
import type { CameraProvider } from "../provider";
import { approvedUrl, boundedGet, boundedJson, coordinates, nonempty, object, timestamp } from "../provider";

export const SINGAPORE_API = "https://api.data.gov.sg/v1/transport/traffic-images";
export const SINGAPORE_HOMEPAGE = "https://data.gov.sg/datasets/d_6cdb6b405b25aaaacbaf7689bcc6fae0/view";
const IMAGE_PATH = /^\/api\/traffic-images\/\d{4}\/\d{2}\/[a-zA-Z0-9-]+\.jpg$/;
const LICENSE = "Singapore Open Data Licence 1.0";

export function singaporeStatus(capturedAt: string | null, now: number): CameraStatus {
  if (!capturedAt) return "offline";
  const age = now - Date.parse(capturedAt);
  return age < -300_000 ? "error" : age <= 120_000 ? "recent" : age <= 3_600_000 ? "stale" : "offline";
}

export function parseSingapore(raw: unknown, fetchedAt: string): Camera[] {
  const items = object(raw)?.items;
  if (!Array.isArray(items) || !items.length) throw new Error("Singapore invalid catalog");
  const cameras = object(items[0])?.cameras;
  if (!Array.isArray(cameras)) throw new Error("Singapore invalid cameras");
  const seen = new Set<string>();
  const result: Camera[] = [];
  for (const value of cameras) {
    const row = object(value);
    const location = object(row?.location);
    const rawId = row?.camera_id;
    const id = typeof rawId === "number" && Number.isSafeInteger(rawId) ? String(rawId) : nonempty(rawId);
    if (!id || !/^\d{1,8}$/.test(id) || seen.has(id) || !coordinates(location?.latitude, location?.longitude)) continue;
    const image = nonempty(row?.image);
    if (!image) continue;
    try { approvedUrl(image, ["images.data.gov.sg"], IMAGE_PATH); } catch { continue; }
    seen.add(id);
    const capturedAt = timestamp(row?.timestamp);
    result.push({
      id: `singapore:${id}`, providerId: "singapore", providerName: "LTA / data.gov.sg",
      name: null, country: "Singapore", region: null, city: null,
      latitude: location.latitude, longitude: location.longitude as number, direction: null,
      mediaType: "near_live_image", streamProtocol: null, streamUrl: null, imageUrl: image,
      capturedAt, updatedAt: capturedAt, fetchedAt, expectedRefreshSeconds: 60,
      officialPageUrl: null, providerHomepageUrl: SINGAPORE_HOMEPAGE, providerApiUrl: SINGAPORE_API,
      attribution: "Traffic Images © Land Transport Authority, via data.gov.sg", license: LICENSE,
      status: singaporeStatus(capturedAt, Date.parse(fetchedAt)),
      health: "ok",
    });
  }
  if (!result.length) throw new Error("Singapore no valid cameras");
  return result;
}

export const singaporeProvider: CameraProvider = {
  id: "singapore", ttlMs: 60_000, retryMs: 60_000, requiredKeyEnv: null,
  descriptor: { id: "camera:singapore", kind: "camera", name: "LTA / data.gov.sg", category: "road-camera", homepage: SINGAPORE_HOMEPAGE, license: LICENSE, nature: "images routières quasi directes, collecte toutes les 20 s", staleAfterMs: 180_000, quota: "API recommandée à une requête par minute" },
  async fetchCatalog(fetcher) { return parseSingapore(await boundedJson(SINGAPORE_API, ["api.data.gov.sg"], /^\/v1\/transport\/traffic-images$/, fetcher), new Date().toISOString()); },
  async frame(camera, fetcher) {
    if (!camera.imageUrl) throw new Error("Singapore image unavailable");
    return boundedGet(camera.imageUrl, ["images.data.gov.sg"], IMAGE_PATH, "image", fetcher);
  },
};
