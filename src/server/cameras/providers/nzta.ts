import type { Camera } from "@/types/cameras";
import type { CameraProvider } from "../provider";
import { approvedUrl, boundedGet, boundedJson, coordinates, nonempty, object } from "../provider";

export const NZTA_API = "https://trafficnz.info/service/traffic/rest/4/cameras/all";
export const NZTA_HOME = "https://www.nzta.govt.nz/about-us/our-data-and-official-information/use-our-data/";
const IMAGE_PATH = /^\/camera\/\d{1,8}\.jpg$/;

export function parseNzta(raw: unknown, fetchedAt: string): Camera[] {
  const rows = object(object(raw)?.response)?.camera;
  if (!Array.isArray(rows)) throw new Error("NZTA invalid catalog");
  const cameras: Camera[] = [];
  const seen = new Set<string>();
  for (const value of rows) {
    const row = object(value);
    const id = row?.id;
    if (!row || typeof id !== "number" || !Number.isSafeInteger(id) || id < 0 || seen.has(String(id)) || !coordinates(row.latitude, row.longitude)) continue;
    const image = nonempty(row.imageUrl);
    if (image !== `/camera/${id}.jpg`) continue;
    const imageUrl = `https://trafficnz.info${image}`;
    approvedUrl(imageUrl, ["trafficnz.info"], IMAGE_PATH);
    seen.add(String(id));
    const offline = row.offline === true || row.underMaintenance === true;
    cameras.push({
      id: `nzta:${id}`, providerId: "nzta", providerName: "NZ Transport Agency Waka Kotahi",
      name: nonempty(row.name) ?? nonempty(row.description), country: "New Zealand", region: nonempty(object(row.region)?.name), city: null,
      latitude: row.latitude, longitude: row.longitude as number, direction: nonempty(row.direction),
      mediaType: "periodic_snapshot", streamProtocol: null, streamUrl: null, imageUrl,
      capturedAt: null, updatedAt: null, fetchedAt, expectedRefreshSeconds: null,
      officialPageUrl: null,
      providerHomepageUrl: NZTA_HOME, providerApiUrl: NZTA_API,
      attribution: "NZ Transport Agency Waka Kotahi / Traffic and Travel API", license: "NZTA Traffic and Travel API Terms of Use",
      status: offline ? "offline" : "unknown", health: offline ? "stale" : "unknown",
    });
  }
  if (!cameras.length) throw new Error("NZTA no valid cameras");
  return cameras;
}

export const nztaProvider: CameraProvider = {
  id: "nzta", ttlMs: 10 * 60_000, retryMs: 60_000, requiredKeyEnv: null,
  descriptor: { id: "camera:nzta", kind: "camera", name: "NZ Transport Agency Waka Kotahi", category: "road-camera", homepage: NZTA_HOME, license: "NZTA Traffic and Travel API Terms of Use", nature: "images fixes routières, fraîcheur non publiée", staleAfterMs: 30 * 60_000 },
  async fetchCatalog(fetcher) { return parseNzta(await boundedJson(NZTA_API, ["trafficnz.info"], /^\/service\/traffic\/rest\/4\/cameras\/all$/, fetcher, { Accept: "application/json" }), new Date().toISOString()); },
  async frame(camera, fetcher) {
    if (!camera.imageUrl) throw new Error("NZTA image unavailable");
    return boundedGet(camera.imageUrl, ["trafficnz.info"], IMAGE_PATH, "image", fetcher);
  },
};
