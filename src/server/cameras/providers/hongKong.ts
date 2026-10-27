import type { Camera } from "@/types/cameras";
import type { CameraProvider } from "../provider";
import { approvedUrl, boundedGet, coordinates } from "../provider";

export const HONG_KONG_CATALOG = "https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.csv";
export const HONG_KONG_HOME = "https://data.gov.hk/en-data/dataset/hk-td-tis_2-traffic-snapshot-images";
const IMAGE_HOST = "tdcctv.data.one.gov.hk";
const IMAGE_PATH = /^\/[A-Z0-9]{3,12}\.JPG$/;

/** The official CSV resource is UTF-16LE, tab-separated and includes a BOM. */
export function parseHongKong(bytes: Uint8Array, fetchedAt: string): Camera[] {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xfe) throw new Error("Hong Kong invalid UTF-16 catalog");
  const rows = new TextDecoder("utf-16le").decode(bytes.subarray(2)).trim().split(/\r?\n/);
  if (rows.shift()?.toLowerCase() !== "key\tregion\tdistrict\tdescription\teasting\tnorthing\tlatitude\tlongitude\turl") throw new Error("Hong Kong invalid columns");
  const cameras: Camera[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const cells = row.split("\t");
    if (cells.length !== 9) continue;
    const [key, region, city, name, , , lat, lon, image] = cells;
    if (!/^[A-Z0-9]{3,12}$/.test(key) || seen.has(key)) continue;
    const latitude = Number(lat); const longitude = Number(lon);
    if (!coordinates(latitude, longitude)) continue;
    try {
      const url = approvedUrl(image, [IMAGE_HOST], IMAGE_PATH);
      if (url.pathname !== `/${key}.JPG` || url.search) continue;
    } catch { continue; }
    seen.add(key);
    cameras.push({
      id: `hongkong:${key}`, providerId: "hongkong", providerName: "Hong Kong Transport Department",
      name: name || null, country: "Hong Kong", region: region || null, city: city || null,
      latitude, longitude, direction: null, mediaType: "near_live_image", streamProtocol: null, streamUrl: null,
      imageUrl: image, capturedAt: null, updatedAt: null, fetchedAt, expectedRefreshSeconds: 120,
      officialPageUrl: null, providerHomepageUrl: HONG_KONG_HOME, providerApiUrl: HONG_KONG_CATALOG,
      attribution: "Hong Kong Transport Department / DATA.GOV.HK", license: null,
      status: "unknown", health: "unknown",
    });
  }
  if (!cameras.length) throw new Error("Hong Kong no valid cameras");
  return cameras;
}

export const hongKongProvider: CameraProvider = {
  id: "hongkong", ttlMs: 24 * 60 * 60_000, retryMs: 5 * 60_000, requiredKeyEnv: null,
  descriptor: { id: "camera:hongkong", kind: "camera", name: "Hong Kong Transport Department", category: "road-camera", homepage: HONG_KONG_HOME, license: null, nature: "images routières actualisées environ toutes les 2 min ; capture non publiée", staleAfterMs: 2 * 24 * 60 * 60_000 },
  async fetchCatalog(fetcher) { return parseHongKong(await boundedGet(HONG_KONG_CATALOG, ["static.data.gov.hk"], /^\/td\/traffic-snapshot-images\/code\/Traffic_Camera_Locations_En\.csv$/, "text", fetcher), new Date().toISOString()); },
  async frame(camera, fetcher) {
    if (!camera.imageUrl) throw new Error("Hong Kong image unavailable");
    return boundedGet(camera.imageUrl, [IMAGE_HOST], IMAGE_PATH, "image", fetcher);
  },
};
