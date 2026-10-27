import type { Camera } from "@/types/cameras";
import type { CameraProvider } from "../provider";
import { approvedUrl, boundedGet, coordinates } from "../provider";

export const DRIVEBC_CATALOG = "https://catalogue.data.gov.bc.ca/dataset/6b39a910-6c77-476f-ac96-7b4f18849b1c/resource/a9d52d85-8402-4ce7-b2ac-a2779837c48a/download/webcams.csv";
export const DRIVEBC_HOME = "https://www.drivebc.ca/cameras";
const CSV_PATH = /^\/dataset\/6b39a910-6c77-476f-ac96-7b4f18849b1c\/resource\/a9d52d85-8402-4ce7-b2ac-a2779837c48a\/download\/webcams\.csv$/;
const IMAGE_PATH = /^\/images\/\d{1,8}\.jpg$/;

function csvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let field = ""; let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (quoted) throw new Error("DriveBC invalid CSV");
  if (row.length || field) { row.push(field); rows.push(row); }
  return rows;
}

export function parseDriveBc(bytes: Uint8Array, fetchedAt: string): Camera[] {
  const rows = csvRows(new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""));
  const header = rows.shift();
  const expected = ["id", "camName", "links_camDetailsPage", "links_imageURL", "credit", "region_name", "orientation", "latitude", "longitude"];
  if (!header || !expected.every((field) => header.includes(field))) throw new Error("DriveBC invalid columns");
  const position = (field: string) => header.indexOf(field);
  const cameras: Camera[] = []; const seen = new Set<string>();
  for (const row of rows) {
    if (row.length !== header.length) continue;
    const get = (field: string) => row[position(field)]?.trim() ?? "";
    const id = get("id");
    const latitude = Number(get("latitude")); const longitude = Number(get("longitude"));
    if (!/^\d{1,8}$/.test(id) || seen.has(id) || !coordinates(latitude, longitude)) continue;
    const imageUrl = get("links_imageURL"); const officialPageUrl = get("links_camDetailsPage");
    try {
      if (approvedUrl(imageUrl, ["www.drivebc.ca"], IMAGE_PATH).pathname !== `/images/${id}.jpg`) continue;
      if (approvedUrl(officialPageUrl, ["www.drivebc.ca"], /^\/cameras\/\d{1,8}$/).pathname !== `/cameras/${id}`) continue;
    } catch { continue; }
    seen.add(id);
    cameras.push({
      id: `drivebc:${id}`, providerId: "drivebc", providerName: "DriveBC / Government of British Columbia",
      name: get("camName") || null, country: "Canada", region: get("region_name") || "British Columbia", city: null,
      latitude, longitude, direction: get("orientation") || null,
      mediaType: "periodic_snapshot", streamProtocol: null, streamUrl: null, imageUrl,
      capturedAt: null, updatedAt: null, fetchedAt, expectedRefreshSeconds: null,
      officialPageUrl, providerHomepageUrl: DRIVEBC_HOME, providerApiUrl: DRIVEBC_CATALOG,
      attribution: `Province of British Columbia / DriveBC${get("credit") ? ` · ${get("credit")}` : ""}`,
      license: "Open Government Licence - British Columbia", status: "unknown", health: "unknown",
    });
  }
  if (!cameras.length) throw new Error("DriveBC no valid cameras");
  return cameras;
}

export const driveBcProvider: CameraProvider = {
  id: "drivebc", ttlMs: 24 * 60 * 60_000, retryMs: 5 * 60_000, requiredKeyEnv: null,
  descriptor: { id: "camera:drivebc", kind: "camera", name: "DriveBC / Government of British Columbia", category: "road-camera", homepage: DRIVEBC_HOME, license: "Open Government Licence - British Columbia", nature: "images routières ; heure de capture et cadence non publiées", staleAfterMs: 2 * 24 * 60 * 60_000 },
  async fetchCatalog(fetcher) { return parseDriveBc(await boundedGet(DRIVEBC_CATALOG, ["catalogue.data.gov.bc.ca"], CSV_PATH, "text", fetcher), new Date().toISOString()); },
  async frame(camera, fetcher) {
    if (!camera.imageUrl) throw new Error("DriveBC image unavailable");
    return boundedGet(camera.imageUrl, ["www.drivebc.ca"], IMAGE_PATH, "image", fetcher);
  },
};
