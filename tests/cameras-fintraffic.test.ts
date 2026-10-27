import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertFintrafficUrl, cameraStatus, fetchFintraffic, parseFintraffic } from "@/server/cameras/providers/fintraffic";
import { filterCameras, loadCameras, parseCameraQuery, resetCameraCache } from "@/server/cameras";
import { getSourceHealth, resetSourceHealth } from "@/server/health/registry";

const now = "2026-10-26T08:00:00Z";
const station = (overrides: Record<string, unknown> = {}) => ({ type: "Feature", geometry: { type: "Point", coordinates: [24.9, 60.2] }, properties: { id: "C01503", name: "kt51_Inkoo", collectionStatus: "GATHERING", presets: [{ id: "C0150301", inCollection: true }], ...overrides } });
const catalog = (features: unknown[] = [station()]) => ({ type: "FeatureCollection", features });
const data = (time: string | null = "2026-10-26T07:55:00Z") => ({ stations: [{ id: "C01503", presets: [{ id: "C0150301", measuredTime: time }] }] });
const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const fetcher = (stations: unknown = catalog(), measurements: unknown = data()) => vi.fn(async (url: string | URL | Request) => jsonResponse(String(url).endsWith("/data") ? measurements : stations)) as unknown as typeof fetch;

beforeEach(() => { resetCameraCache(); resetSourceHealth(); });

describe("Fintraffic camera parsing", () => {
  it("normalise les vrais champs, capture et provenance sans inventer direction/ville", () => {
    const [camera] = parseFintraffic(catalog(), data(), now);
    expect(camera).toMatchObject({ id: "C0150301", providerId: "fintraffic", latitude: 60.2, longitude: 24.9, name: "kt51_Inkoo", city: null, direction: null, capturedAt: "2026-10-26T07:55:00.000Z", mediaType: "periodic_snapshot", status: "recent", license: "CC BY 4.0", officialPageUrl: null, providerHomepageUrl: "https://www.digitraffic.fi/en/road-traffic/" });
    expect(camera).not.toHaveProperty("sourceUrl");
  });
  it("écarte les coordonnées absentes ou invalides", () => {
    expect(parseFintraffic(catalog([station(), { ...station(), geometry: null }, { ...station(), geometry: { type: "Point", coordinates: [200, 60] } }]), data(), now)).toHaveLength(1);
  });
  it("marque offline sans snapshot ou hors collecte", () => {
    expect(parseFintraffic(catalog(), data(null), now)[0].status).toBe("offline");
    expect(parseFintraffic(catalog([station({ collectionStatus: "STOPPED" })]), data(), now)[0].status).toBe("offline");
  });
  it("classe les horodatages récents, anciens, futurs et expirés", () => {
    expect(cameraStatus("2026-10-26T07:20:00Z", true, Date.parse(now))).toBe("stale");
    expect(cameraStatus("2026-10-27T08:00:00Z", true, Date.parse(now))).toBe("error");
    expect(cameraStatus("2026-10-24T08:00:00Z", true, Date.parse(now))).toBe("offline");
  });
  it("refuse une structure source invalide", () => expect(() => parseFintraffic({ hello: true }, data(), now)).toThrow(/invalid catalog/));
});

describe("catalog cache and filters", () => {
  it("réutilise le cache et publie la santé", async () => {
    const get = fetcher();
    expect((await loadCameras(get, Date.now(), "fintraffic")).cameras).toHaveLength(1);
    expect((await loadCameras(get, Date.now(), "fintraffic")).cameras).toHaveLength(1);
    expect(vi.mocked(get).mock.calls).toHaveLength(2);
    expect(getSourceHealth("camera:fintraffic")?.itemCount).toBe(1);
  });
  it("conserve le dernier catalogue et signale une panne après expiration", async () => {
    const get = fetcher();
    await loadCameras(get, Date.now(), "fintraffic");
    const fail = vi.fn(async () => { throw new Error("source unavailable"); }) as unknown as typeof fetch;
    const result = await loadCameras(fail, Date.now() + 11 * 60_000, "fintraffic");
    expect(result.status).toBe("stale");
    expect(result.cameras).toHaveLength(1);
    expect(getSourceHealth("camera:fintraffic")?.status).toBe("stale");
  });
  it("signale une source indisponible sans cache et un timeout", async () => {
    const fail = vi.fn(async () => { throw new DOMException("aborted", "TimeoutError"); }) as unknown as typeof fetch;
    expect((await loadCameras(fail, Date.now(), "fintraffic")).status).toBe("error");
    expect(getSourceHealth("camera:fintraffic")?.status).toBe("unavailable");
  });
  it("valide bbox et limit strictement puis filtre", () => {
    for (const invalid of ["24,60,23,61", "24,60,25", "24,60,181,61", "24,NaN,25,61", "24,60,25,60"]) expect(() => parseCameraQuery(new URLSearchParams({ bbox: invalid }))).toThrow();
    expect(() => parseCameraQuery(new URLSearchParams({ limit: "2501" }))).toThrow();
    const cameras = parseFintraffic(catalog([station({ presets: [{ id: "C0150301", inCollection: true }, { id: "C0150302", inCollection: true }] })]), data(), now);
    const result = filterCameras({ cameras, total: cameras.length, counts: { liveVideo: 0, nearLiveImage: 0, periodicSnapshot: cameras.length }, status: "ok", message: null, fetchedAt: now, nextCursor: null }, parseCameraQuery(new URLSearchParams({ bbox: "24.5,60,25.3,60.5", limit: "1" })));
    expect(result.total).toBe(2);
    expect(result.cameras).toHaveLength(1);
  });
});

describe("frame boundary", () => {
  it("refuse domaines, IP privées, localhost et metadata endpoints", () => {
    for (const url of ["https://evil.example/C0150301.jpg", "http://weathercam.digitraffic.fi/C0150301.jpg", "https://127.0.0.1/C0150301.jpg", "https://localhost/C0150301.jpg", "http://169.254.169.254/latest/meta-data", "https://weathercam.digitraffic.fi.evil.example/C0150301.jpg"]) expect(() => assertFintrafficUrl(url, "image")).toThrow();
  });
  it("refuse redirection, mauvais type et image trop volumineuse", async () => {
    const url = "https://weathercam.digitraffic.fi/C0150301.jpg";
    const mock = (response: Response) => vi.fn(async () => response) as unknown as typeof fetch;
    await expect(fetchFintraffic(url, "image", mock(new Response(null, { status: 302, headers: { Location: "http://localhost" } })))).rejects.toThrow();
    await expect(fetchFintraffic(url, "image", mock(new Response("x", { headers: { "content-type": "text/html" } })))).rejects.toThrow(/Content-Type/);
    await expect(fetchFintraffic(url, "image", mock(new Response(new Uint8Array(10), { headers: { "content-type": "image/jpeg" } })), 5)).rejects.toThrow(/too large/);
  });
});
