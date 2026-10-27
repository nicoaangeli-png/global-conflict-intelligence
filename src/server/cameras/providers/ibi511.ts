import type { Camera } from "@/types/cameras";
import type { CameraProvider } from "../provider";
import { approvedUrl, boundedJson, coordinates, nonempty, object } from "../provider";

export interface Ibi511Config {
  id: string;
  name: string;
  country: string;
  region: string;
  apiHost: string;
  apiPath: string;
  apiKeyEnv: string;
  homepage: string;
  videoHosts: readonly string[];
  license: string | null;
  attribution: string;
}

/** Hosts and media capabilities are documented for these two networks. More 511 sites can be configured without duplicating the parser. */
export const IBI511_NETWORKS: readonly Ibi511Config[] = [
  { id: "wisconsin", name: "Wisconsin 511 / WisDOT", country: "United States", region: "Wisconsin", apiHost: "511wi.gov", apiPath: "/api/v2/get/cameras", apiKeyEnv: "CAMERA_WISCONSIN_API_KEY", homepage: "https://511wi.gov/", videoHosts: ["cctv1.dot.wi.gov"], license: null, attribution: "Wisconsin 511 / WisDOT" },
  { id: "nevada", name: "Nevada 511 / NDOT", country: "United States", region: "Nevada", apiHost: "www.nvroads.com", apiPath: "/api/v2/get/cameras", apiKeyEnv: "CAMERA_NEVADA_API_KEY", homepage: "https://www.nvroads.com/", videoHosts: ["d1wse1.its.nv.gov"], license: null, attribution: "Nevada 511 / NDOT" },
];

function humanPage(raw: unknown, config: Ibi511Config): string | null {
  const value = nonempty(raw);
  if (!value) return null;
  try {
    const url = approvedUrl(value, [config.apiHost], /^\/map\/Cctv\/\d+$/);
    if (url.search) return null;
    return url.href;
  } catch { return null; }
}

function hlsUrl(raw: unknown, config: Ibi511Config): string | null {
  const value = nonempty(raw);
  if (!value) return null;
  try {
    const url = approvedUrl(value, config.videoHosts, /^\/[a-zA-Z0-9/_.,-]+\.m3u8$/, true);
    if (url.search) return null;
    return url.href;
  } catch { return null; }
}

export function parseIbi511(raw: unknown, config: Ibi511Config, fetchedAt: string): Camera[] {
  if (!Array.isArray(raw)) throw new Error(`${config.id} invalid catalog`);
  const cameras: Camera[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const row = object(item);
    if (!row || !coordinates(row.Latitude, row.Longitude) || !Array.isArray(row.Views)) continue;
    for (const value of row.Views) {
      const view = object(value);
      const id = typeof view?.Id === "number" && Number.isSafeInteger(view.Id) ? String(view.Id) : null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const enabled = view?.Status === "Enabled";
      const streamUrl = enabled ? hlsUrl(view?.VideoUrl, config) : null;
      cameras.push({
        id: `${config.id}:${id}`, providerId: config.id, providerName: config.name,
        name: nonempty(view?.Description) ?? nonempty(row.Location) ?? nonempty(row.Roadway),
        country: config.country, region: nonempty(row.Region) ?? config.region, city: null,
        latitude: row.Latitude, longitude: row.Longitude as number, direction: nonempty(row.Direction),
        mediaType: streamUrl ? "live_video" : "periodic_snapshot", streamProtocol: streamUrl ? "hls" : null,
        streamUrl, imageUrl: null, capturedAt: null, updatedAt: null, fetchedAt, expectedRefreshSeconds: null,
        officialPageUrl: humanPage(view?.Url, config), providerHomepageUrl: config.homepage,
        providerApiUrl: `https://${config.apiHost}${config.apiPath}`, attribution: config.attribution,
        license: config.license, status: !enabled ? "offline" : streamUrl ? "live" : "offline", health: enabled ? "ok" : "stale",
      });
    }
  }
  if (!cameras.length) throw new Error(`${config.id} no valid cameras`);
  return cameras;
}

export function ibi511Provider(config: Ibi511Config): CameraProvider {
  const path = new RegExp(`^${config.apiPath.replaceAll("/", "\\/")}$`);
  return {
    id: config.id, ttlMs: 5 * 60_000, retryMs: 60_000, requiredKeyEnv: config.apiKeyEnv,
    descriptor: { id: `camera:${config.id}`, kind: "camera", name: config.name, category: "road-camera", homepage: config.homepage, license: config.license, nature: "HLS si VideoUrl valide ; autres vues sans média vérifié", staleAfterMs: 15 * 60_000, quota: "10 appels / 60 s" },
    async fetchCatalog(fetcher, key) {
      if (!key) throw new Error("Camera provider key missing");
      const url = `https://${config.apiHost}${config.apiPath}?key=${encodeURIComponent(key)}&format=json`;
      return parseIbi511(await boundedJson(url, [config.apiHost], path, fetcher), config, new Date().toISOString());
    },
  };
}
