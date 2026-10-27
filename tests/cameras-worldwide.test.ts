import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseSingapore } from "@/server/cameras/providers/singapore";
import { IBI511_NETWORKS, parseIbi511 } from "@/server/cameras/providers/ibi511";
import { parseNzta } from "@/server/cameras/providers/nzta";
import { parseHongKong } from "@/server/cameras/providers/hongKong";
import { parseDriveBc } from "@/server/cameras/providers/driveBc";
import { approvedUrl, boundedGet } from "@/server/cameras/provider";
import { filterCameras, loadCameras, parseCameraQuery, resetCameraCache } from "@/server/cameras";
import { getSourceHealth, resetSourceHealth } from "@/server/health/registry";

const at = "2026-10-27T09:00:00Z";
const singapore = { items: [{ cameras: [{ camera_id: "2701", timestamp: "2026-10-27T08:59:40Z", location: { latitude: 1.44, longitude: 103.77 }, image: "https://images.data.gov.sg/api/traffic-images/2026/10/abc-123.jpg" }] }] };
const nzta = { response: { camera: [{ id: 714, latitude: -43.9, longitude: 171.7, name: "SH1 Tinwald", region: { name: "Canterbury" }, imageUrl: "/camera/714.jpg", viewUrl: "/camera/view/714", offline: false }] } };
const wi = IBI511_NETWORKS[0];
const nv = IBI511_NETWORKS[1];
const ibi = (video: string | null, url = "https://511wi.gov/map/Cctv/1450") => [{ Id: 3, Latitude: 44.3, Longitude: -88.4, Roadway: "I-41", Views: [{ Id: 1450, Url: url, Status: "Enabled", VideoUrl: video }] }];

beforeEach(() => { resetCameraCache(); resetSourceHealth(); delete process.env.CAMERA_WISCONSIN_API_KEY; delete process.env.CAMERA_NEVADA_API_KEY; });

describe("provider normalization", () => {
  it("classifies Singapore by actual timestamp and rejects arbitrary images", () => {
    const [camera] = parseSingapore(singapore, at);
    expect(camera).toMatchObject({ id: "singapore:2701", mediaType: "near_live_image", status: "recent", expectedRefreshSeconds: 60, officialPageUrl: null });
    expect(parseSingapore(singapore, "2026-10-27T09:20:00Z")[0].status).toBe("stale");
    expect(() => parseSingapore({ items: [{ cameras: [{ ...singapore.items[0].cameras[0], image: "http://169.254.169.254/latest/meta-data" }] }] }, at)).toThrow(/no valid/);
    expect(() => parseSingapore({ items: "bad" }, at)).toThrow(/invalid/);
  });
  it("retains NZTA unknown freshness rather than inventing a capture time", () => {
    expect(parseNzta(nzta, at)[0]).toMatchObject({ id: "nzta:714", mediaType: "periodic_snapshot", capturedAt: null, expectedRefreshSeconds: null, status: "unknown", officialPageUrl: null });
    expect(() => parseNzta({ response: { camera: [{ ...nzta.response.camera[0], longitude: 400 }] } }, at)).toThrow(/no valid/);
  });
  it("decodes the official Hong Kong UTF-16 TSV and rejects a malicious image URL", () => {
    const header = "key\tregion\tdistrict\tdescription\teasting\tnorthing\tlatitude\tlongitude\turl";
    const row = "BC101F\tHong Kong Island\tCentral\tRoad camera\t0\t0\t22.28\t114.16\thttps://tdcctv.data.one.gov.hk/BC101F.JPG";
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${header}\r\n${row}`, "utf16le")]);
    expect(parseHongKong(bytes, at)[0]).toMatchObject({ id: "hongkong:BC101F", mediaType: "near_live_image", capturedAt: null, status: "unknown", license: "DATA.GOV.HK Terms of Use", attribution: "Government of the Hong Kong Special Administrative Region / Transport Department / DATA.GOV.HK" });
    const evil = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${header}\r\n${row.replace("https://tdcctv.data.one.gov.hk/BC101F.JPG", "http://169.254.169.254/latest/meta-data")}`, "utf16le")]);
    expect(() => parseHongKong(evil, at)).toThrow(/no valid/);
  });
  it("parses the licensed DriveBC CSV and keeps the real human camera page", () => {
    const header = '"id","camName","links_camDetailsPage","links_imageURL","credit","region_name","orientation","latitude","longitude"';
    const row = '"864","West Twin - W","https://www.drivebc.ca/cameras/864","https://www.drivebc.ca/images/864.jpg","","Northern","W","53.43988","-120.50709"';
    const parsed = parseDriveBc(Buffer.from(`\uFEFF${header}\r\n${row}`, "utf8"), at);
    expect(parsed[0]).toMatchObject({ id: "drivebc:864", country: "Canada", status: "unknown", capturedAt: null, mediaType: "periodic_snapshot", officialPageUrl: "https://www.drivebc.ca/cameras/864" });
    expect(() => parseDriveBc(Buffer.from(`${header}\n${row.replace("www.drivebc.ca/images", "localhost/images")}`), at)).toThrow(/no valid/);
  });
  it("uses actual validated HLS VideoUrl; no VideoUrl remains a snapshot", () => {
    const video = "https://cctv1.dot.wi.gov:443/rtplive/CCTV-44-0081/playlist.m3u8";
    expect(parseIbi511(ibi(video), wi, at)[0]).toMatchObject({ mediaType: "live_video", streamProtocol: "hls", status: "live", officialPageUrl: "https://511wi.gov/map/Cctv/1450" });
    expect(parseIbi511(ibi(null), wi, at)[0]).toMatchObject({ mediaType: "periodic_snapshot", streamUrl: null, imageUrl: null, status: "offline" });
    expect(parseIbi511(ibi("http://169.254.169.254/latest/meta-data", "https://evil.example/map/Cctv/1450"), wi, at)[0]).toMatchObject({ streamUrl: null, officialPageUrl: null });
    const nevada = [{ ...ibi(null)[0], Views: [{ Id: 2362, Status: "Enabled", Url: "https://www.nvroads.com/map/Cctv/2362", VideoUrl: "https://d1wse1.its.nv.gov:443/vegasxcd01/stream/playlist.m3u8" }] }];
    expect(parseIbi511(nevada, nv, at)[0].mediaType).toBe("live_video");
  });
});

describe("independent aggregation, filters and security", () => {
  it("keeps Singapore when Fintraffic fails, while absent optional keys are unconfigured", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes("api.data.gov.sg") ? new Response(JSON.stringify(singapore), { headers: { "content-type": "application/json" } }) : new Response(null, { status: 503 })) as unknown as typeof fetch;
    const catalog = await loadCameras(fetcher);
    expect(catalog.cameras.some((camera) => camera.providerId === "singapore")).toBe(true);
    expect(catalog.status).toBe("stale");
    expect(getSourceHealth("camera:wisconsin")?.status).toBe("unconfigured");
    expect(getSourceHealth("camera:nevada")?.status).toBe("unconfigured");
    expect(catalog.cameras[0]).not.toHaveProperty("imageUrl");
    expect(catalog.cameras[0]).not.toHaveProperty("providerApiUrl");
  });
  it("filters bbox, media, status, country and cursor without unbounded output", () => {
    const cameras = [...parseSingapore(singapore, at), ...parseNzta(nzta, at)];
    const catalog = { cameras, total: 2, counts: { liveVideo: 0, nearLiveImage: 1, periodicSnapshot: 1 }, status: "ok" as const, message: null, fetchedAt: at, nextCursor: null };
    const query = parseCameraQuery(new URLSearchParams({ bbox: "103,1,104,2", mediaType: "near_live_image", country: "SG", status: "recent", limit: "1" }));
    expect(filterCameras(catalog, query)).toMatchObject({ total: 1, cameras: [{ id: "singapore:2701" }] });
    expect(filterCameras(catalog, parseCameraQuery(new URLSearchParams({ limit: "1" }))).nextCursor).toBe("1");
    expect(filterCameras(catalog, parseCameraQuery(new URLSearchParams({ limit: "1", cursor: "1" }))).cameras[0].id).toBe("nzta:714");
    for (const [key, value] of [["bbox", "103,1,102,2"], ["bbox", "NaN,1,104,2"], ["limit", "2501"], ["cursor", "-1"], ["liveOnly", "yes"], ["mediaType", "video"]]) expect(() => parseCameraQuery(new URLSearchParams({ [key]: value }))).toThrow();
  });
  it("rejects SSRF, redirects, bad MIME, oversized and invalid JPEG", async () => {
    for (const url of ["http://localhost/camera/714.jpg", "https://127.0.0.1/camera/714.jpg", "http://169.254.169.254/latest/meta-data", "https://trafficnz.info.evil.test/camera/714.jpg", "https://trafficnz.info:444/camera/714.jpg", "https://user:pass@trafficnz.info/camera/714.jpg"]) expect(() => approvedUrl(url, ["trafficnz.info"], /^\/camera\/\d+\.jpg$/)).toThrow();
    const url = "https://trafficnz.info/camera/714.jpg";
    const get = (response: Response) => vi.fn(async () => response) as unknown as typeof fetch;
    await expect(boundedGet(url, ["trafficnz.info"], /^\/camera\/\d+\.jpg$/, "image", get(new Response(null, { status: 302, headers: { Location: "http://localhost" } })))).rejects.toThrow();
    await expect(boundedGet(url, ["trafficnz.info"], /^\/camera\/\d+\.jpg$/, "image", get(new Response("bad", { headers: { "content-type": "text/html" } })))).rejects.toThrow(/Content-Type/);
    await expect(boundedGet(url, ["trafficnz.info"], /^\/camera\/\d+\.jpg$/, "image", get(new Response("bad", { headers: { "content-type": "image/jpeg", "content-length": "5000000" } })))).rejects.toThrow(/too large/);
    await expect(boundedGet(url, ["trafficnz.info"], /^\/camera\/\d+\.jpg$/, "image", get(new Response("bad", { headers: { "content-type": "image/jpeg" } })))).rejects.toThrow(/JPEG/);
  });
  it("uses an upstream ETag for a conditional catalog refresh", async () => {
    const url = "https://trafficnz.info/service/traffic/rest/4/cameras/all";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{"response":{}}', { headers: { "content-type": "application/json", etag: '"catalog-1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const path = /^\/service\/traffic\/rest\/4\/cameras\/all$/;
    const first = await boundedGet(url, ["trafficnz.info"], path, "json", fetcher);
    const second = await boundedGet(url, ["trafficnz.info"], path, "json", fetcher);
    expect(second).toEqual(first);
    expect(new Headers(fetcher.mock.calls[1][1].headers).get("If-None-Match")).toBe('"catalog-1"');
  });
});
