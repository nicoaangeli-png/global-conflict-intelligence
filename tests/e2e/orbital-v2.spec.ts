import { expect, test, type Page } from "@playwright/test";
import { CAMERA } from "@/lib/config/visual";
import { FEED_CATEGORIES } from "@/types/feeds";
import { CLUSTER, FEED_ITEMS, NOW, SOURCE_STATES, mockApis, ndjson } from "./fixtures";
import type { OrbitalEvent } from "@/types/detection";

const CENTER = { lat: 90 - CAMERA.initial.phi * 180 / Math.PI, lon: (CAMERA.initial.theta - Math.PI / 2) * 180 / Math.PI };
const conflict = { ...CLUSTER, geoPrecision: "city", latitude: CENTER.lat, longitude: CENTER.lon, locality: "Zone V2 (fixture)" };
const locatedFeed = { ...FEED_ITEMS[0], lat: CENTER.lat, lon: CENTER.lon };
const aircraft = { ...locatedFeed, id: "aircraft:test", category: "military", vehicle: "aircraft", sourceId: "adsb-lol-military",
  title: "Avion V2 fixture", summary: "Cap 90° ; fixture uniquement", track: [{ lat: CENTER.lat - 0.3, lon: CENTER.lon - 0.3, at: new Date(Date.now() - 120_000).toISOString() }] };
const vessel = { ...aircraft, id: "vessel:test", sourceId: "aisstream-military", vehicle: "vessel", title: "Navire V2 fixture" };

const snapshot = { id: "C0150301", providerId: "fintraffic", providerName: "Fintraffic / Digitraffic", name: "Caméra V2 fixture",
  country: "Finland", region: null, city: null, latitude: CENTER.lat, longitude: CENTER.lon, direction: null,
  mediaType: "periodic_snapshot", streamProtocol: null, capturedAt: NOW, updatedAt: NOW, fetchedAt: NOW,
  expectedRefreshSeconds: 600, officialPageUrl: null, providerHomepageUrl: "https://www.digitraffic.fi/en/road-traffic/",
  attribution: "Fintraffic / Digitraffic", license: "CC BY 4.0", status: "recent", health: "ok" };

async function ready(page: Page) {
  await page.goto("/lab/orbital-v2");
  const canvas = page.getByTestId("orbital-globe-v2");
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.getAttribute("data-globe2")).toBeTruthy();
  await expect(page.getByRole("button", { name: "Parler à AURA", exact: true })).toBeVisible();
  return canvas;
}
async function state(page: Page) { return JSON.parse((await page.getByTestId("orbital-globe-v2").getAttribute("data-globe2"))!); }

const detection: OrbitalEvent = {
  id: "v2:detection", title: "Détection V2 fixture", kind: "incident", firstReceivedAt: NOW, lastReceivedAt: NOW, occurredAt: null,
  position: { lat: 48.8566, lon: 2.3522, precision: "city" }, place: "Paris (fixture)", countries: ["FRA"],
  confidenceScore: 42, confidence: { score: 42, status: "watch", factors: [], confirmationBasis: null, caveats: ["Fixture non confirmée"], version: 1 },
  importanceScore: 30, importanceReasons: [], status: "watch", independentSourceCount: 1, distinctProviderCount: 1, evidenceCount: 0,
  contradictions: [], evidenceTruncated: false, timeline: [], evidence: [],
};

test.describe("ORBITAL V1 product on the V2 spatial runtime", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("same shell, categories, Settings and AURA; no lab replacement panels", async ({ page }) => {
    const categories = new Set<string>();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await mockApis(page, { override: async (route, url) => {
      if (url.pathname === "/api/feeds") categories.add(url.searchParams.get("category") ?? "");
      if (url.pathname === "/api/agent" && route.request().method() === "POST") {
        await route.fulfill({ contentType: "application/x-ndjson", body: ndjson([
          { t: "delta", text: "Réponse AURA fixture" }, { t: "sources", items: [{ title: "Source fixture", url: "https://example.org/" }] }, { t: "done" },
        ]) }); return true;
      }
      return false;
    } });
    await ready(page);
    await expect.poll(() => [...categories].sort()).toEqual([...FEED_CATEGORIES].sort());
    await expect(page.locator(".app-header .brand")).toHaveText("ORBITAL");
    await expect(page.locator(".theme-bar")).toBeVisible();
    await expect(page.locator(".left-column")).toContainText("Séisme de test M5.1");
    await expect(page.getByRole("button", { name: "DISTRICT", exact: true })).toHaveCount(0);
    await page.locator("#settings-trigger-button").click();
    await expect(page.locator("#settings-dialog")).toBeVisible(); await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Parler à AURA", exact: true }).click();
    await page.getByPlaceholder(/Demande à AURA/).fill("Question fixture");
    await page.getByRole("button", { name: "Envoyer la question" }).click();
    await expect(page.getByRole("log", { name: "Conversation avec AURA" })).toContainText("Réponse AURA fixture");
    expect(errors).toEqual([]);
  });

  test("conflict hover/direct click uses V1 Inspector; dragging over it never selects", async ({ page }) => {
    await mockApis(page, { clusters: [conflict], feedItems: [] });
    const canvas = await ready(page);
    await page.mouse.move(720, 450);
    await expect(page.locator(".hover-tip")).toContainText("Zone V2 (fixture)");
    await expect.poll(() => canvas.evaluate(element => element.parentElement?.style.cursor)).toBe("pointer");
    await page.mouse.down(); await page.mouse.move(790, 480, { steps: 8 }); await page.mouse.up();
    await expect(page.getByRole("region", { name: /Zone signalée/ })).toHaveCount(0);
    await page.reload(); await expect.poll(() => state(page)).toHaveProperty("scale", "PLANET");
    await page.mouse.click(720, 450);
    const detail = page.getByRole("region", { name: "Zone signalée : Zone V2 (fixture)", exact: true });
    await expect(detail).toContainText("Un article de presse signale un sujet");
    await expect(detail).toContainText("Dernier enregistrement");
    await expect(detail).toContainText("Enregistrements");
  });

  test("feed selection and direct marker share the same detail and central fly-to", async ({ page }) => {
    await mockApis(page, { clusters: [], feedItems: [locatedFeed] });
    await ready(page); await page.mouse.click(720, 450);
    await expect(page.locator(".right-column")).toContainText("Séisme de test M5.1");
    await expect(page.locator(".right-column")).toContainText("USGS (fixture)");
    await expect(page.locator(".right-column")).toContainText("TEST UNIQUEMENT");
    await page.locator(".left-column").getByText("Séisme de test M5.1").first().click();
    await expect.poll(async () => (await state(page)).target.latDeg).toBeCloseTo(CENTER.lat, 4);
  });

  for (const mobile of [aircraft, vessel]) test(`direct ${mobile.vehicle} click preserves mobile detail`, async ({ page }) => {
    await mockApis(page, { clusters: [], feedItems: [mobile as unknown as typeof FEED_ITEMS[number]] });
    await ready(page); await page.mouse.click(720, 450);
    await expect(page.locator(".right-column")).toContainText(mobile.title);
    await expect(page.locator(".right-column")).toContainText("Cap 90°");
    expect((await state(page)).calls).toBeGreaterThan(10);
  });

  test("camera stays opt-in; a direct globe click opens original CameraDetail and truthful attribution", async ({ page }) => {
    let mediaRequests = 0;
    await mockApis(page, { clusters: [], feedItems: [], override: async (route, url) => {
      if (url.pathname === "/api/cameras") { await route.fulfill({ json: { cameras: [snapshot], total: 1,
        counts: { liveVideo: 0, nearLiveImage: 0, periodicSnapshot: 1 }, nextCursor: null, status: "ok", message: null, fetchedAt: NOW } }); return true; }
      if (url.pathname === "/api/cameras/C0150301") { await route.fulfill({ json: { ...snapshot, imageUrl: "https://weathercam.digitraffic.fi/C0150301.jpg", streamUrl: null, providerApiUrl: null } }); return true; }
      if (url.pathname.endsWith("/frame")) { mediaRequests++; await route.fulfill({ status: 503, body: "fixture unavailable" }); return true; }
      return false;
    } });
    await ready(page); expect(mediaRequests).toBe(0);
    const toggle = page.getByRole("button", { name: /^Calques/ }); await toggle.click();
    await page.getByRole("dialog", { name: "Calques" }).getByRole("checkbox", { name: /CAMÉRAS/ }).check();
    await toggle.click(); expect(mediaRequests).toBe(0);
    await page.mouse.click(720, 450);
    const detail = page.getByRole("region", { name: "Détail caméra" });
    await expect(detail).toContainText("Instantané périodique");
    await expect(detail).toContainText("CC BY 4.0");
    await expect(detail.getByRole("link", { name: /Site du fournisseur/ })).toHaveAttribute("href", snapshot.providerHomepageUrl);
    await expect.poll(() => mediaRequests).toBeGreaterThan(0);
  });

  test("search, country picking, oblique and continuous deep zoom use the new engine", async ({ page }) => {
    await mockApis(page, { clusters: [], feedItems: [] }); await ready(page);
    await page.getByRole("combobox", { name: "Rechercher un pays", exact: true }).first().fill("France");
    await page.getByRole("button", { name: "France FRA", exact: true }).first().click();
    await expect(page.locator(".right-column")).toContainText("France");
    await expect.poll(async () => (await state(page)).target.lonDeg).toBeCloseTo(2.35, 0);
    await page.getByRole("button", { name: "Fermer la fiche pays" }).click();
    await page.mouse.click(720, 450);
    await expect(page.locator(".right-column")).toContainText("France");
    await page.getByRole("button", { name: "Fermer la fiche pays" }).click();
    await page.getByRole("button", { name: "Vue oblique", exact: true }).click();
    await expect.poll(async () => (await state(page)).pitchRad).toBeGreaterThan(0.3);
    await page.mouse.move(720, 450);
    for (let i = 0; i < 50; i++) await page.mouse.wheel(0, -120);
    await expect.poll(async () => (await state(page)).distanceM, { timeout: 15_000 }).toBeLessThan(2_500);
    // Semantic scale is footprint-based and published at a bounded cadence;
    // oblique views must not infer DISTRICT from altitude alone.
    await expect.poll(async () => (await state(page)).scale).toMatch(/^(DISTRICT|SENSOR)$/);
    // Real rendered pixels: a close view must retain the dark ORBITAL surface,
    // rather than the coarse mesh's incorrectly interpolated bright cyan rim.
    await page.mouse.move(850, 860);
    const shot = (await page.screenshot()).toString("base64");
    const localBrightness = await page.evaluate(async data => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Screenshot context unavailable");
      context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, image.width, image.height).data;
      const values: number[] = [];
      for (let y = 220; y < 700; y += 8) for (let x = 500; x < 1050; x += 8) {
        const i = (y * image.width + x) * 4; values.push(Math.max(pixels[i], pixels[i + 1], pixels[i + 2]));
      }
      values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)];
    }, shot);
    expect(localBrightness).toBeLessThan(75);
    await page.getByRole("button", { name: "Vue globale initiale" }).click();
    await expect.poll(async () => (await state(page)).scale).toBe("PLANET");
  });

  test("toolbar zoom updates the existing event aggregation after the camera settles", async ({ page }) => {
    const degrees: string[] = [];
    await mockApis(page, { clusters: [], feedItems: [], override: async (_route, url) => {
      if (url.pathname === "/api/events") degrees.push(url.searchParams.get("degrees") ?? "");
      return false;
    } });
    await ready(page);
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Zoom avant", exact: true }).click();
    await expect.poll(() => degrees.at(-1)).toBe("1.20");
    expect(degrees.length).toBeLessThan(8);
  });

  test("reference layer, source outage and stale feed retain original UI and source caveats", async ({ page }) => {
    await mockApis(page, { clusters: [], sourceStates: [{ ...SOURCE_STATES[0], status: "stale", health: "stale", message: "Fixture en retard" },
      { ...SOURCE_STATES[1], status: "error", health: "unavailable", message: "Fixture indisponible" }],
      override: async (route, url) => {
        if (url.pathname === "/api/layers" && url.searchParams.get("id") === "nuclear_plants") {
          await route.fulfill({ json: { layerId: "nuclear_plants", title: "Centrales", sourceName: "PRIS fixture", homepage: "https://example.org/", license: "Fixture", asOf: NOW, fetchedAt: NOW, status: "ok", message: null, caveat: "Fixture uniquement", features: [{ id: "nuclear:test", name: "Centrale V2 fixture", countries: [], geometry: { type: "Point", coordinates: [CENTER.lon, CENTER.lat] }, properties: {}, url: null }] } }); return true;
        }
        return false;
      } });
    await ready(page);
    const toggle = page.getByRole("button", { name: /^Calques/ }); await toggle.click();
    await page.getByRole("dialog", { name: "Calques" }).getByRole("checkbox", { name: /Centrales/ }).check();
    await toggle.click(); await page.mouse.click(720, 450);
    await expect(page.locator(".right-column")).toContainText("Centrale V2 fixture");
    await page.locator(".left-column").getByRole("button", { name: /Sources/ }).click();
    const sources = page.getByRole("dialog", { name: "Sources de données" });
    await expect(sources).toContainText("Fixture en retard");
    await expect(sources).toContainText("Fixture indisponible");
  });

  test("original DetectionPanel dispatches focus to the V2 engine and preserves its assessment", async ({ page }) => {
    await mockApis(page, { clusters: [], override: async (route, url) => {
      if (url.pathname !== "/api/detection") return false;
      await route.fulfill({ json: { generatedAt: NOW, status: "ok", events: [detection], live: [detection] } }); return true;
    } });
    await ready(page);
    await page.getByRole("button", { name: /Détection V2 fixture/ }).click();
    const dialog = page.getByRole("dialog", { name: "Détail de détection" });
    await expect(dialog).toContainText("42/100");
    await expect(dialog).toContainText("Fixture non confirmée");
    await dialog.getByRole("button", { name: "Localiser sur le globe" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await state(page)).target.latDeg).toBeCloseTo(48.8566, 4);
    await expect.poll(async () => (await state(page)).target.lonDeg).toBeCloseTo(2.3522, 4);
  });

  for (const layer of [{ id: "military_bases", label: /Bases militaires/ }, { id: "submarine_cables", label: /Câbles sous-marins/ }]) {
    test(`existing ${layer.id} geometry and direct picking use WGS84`, async ({ page }) => {
      await mockApis(page, { clusters: [], feedItems: [], override: async (route, url) => {
        if (url.pathname !== "/api/layers" || url.searchParams.get("id") !== layer.id) return false;
        await route.fulfill({ json: { layerId: layer.id, title: layer.id, sourceName: "Source stratégique fixture",
          homepage: "https://example.org/", license: "Fixture", asOf: NOW, fetchedAt: NOW, status: "ok", message: null,
          caveat: "Fixture uniquement", features: [{ id: "reference:test", name: "Référence V2 fixture", countries: [],
            geometry: layer.id === "military_bases" ? { type: "Point", coordinates: [CENTER.lon, CENTER.lat] }
              : { type: "LineString", coordinates: [[CENTER.lon - 1, CENTER.lat], [CENTER.lon + 1, CENTER.lat]] },
            properties: {}, url: "https://example.org/reference" }] } }); return true;
      } });
      await ready(page);
      const toggle = page.getByRole("button", { name: /^Calques/ }); await toggle.click();
      await page.getByRole("dialog", { name: "Calques" }).getByRole("checkbox", { name: layer.label }).check();
      await toggle.click(); await page.mouse.click(720, 450);
      await expect(page.locator(".right-column")).toContainText("Référence V2 fixture");
      await expect(page.locator(".right-column")).toContainText("Source stratégique fixture");
    });
  }

  test("OFAC tint remains opt-in and shares the original country/reference data", async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await mockApis(page, { clusters: [], feedItems: [] }); await ready(page);
    await page.getByRole("button", { name: /^Calques/ }).click();
    const sanctions = page.getByRole("dialog", { name: "Calques" }).getByRole("checkbox", { name: /Sanctions/ });
    await sanctions.check(); await expect(sanctions).toBeChecked();
    await expect(page.getByRole("dialog", { name: "Calques" })).toContainText("OFAC (fixture)");
    await sanctions.uncheck(); await expect(sanctions).not.toBeChecked(); expect(errors).toEqual([]);
  });

  test("client navigation destroys and recreates the scene without extra canvases or WebGL errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error" && /WebGL|Shader|disposed/i.test(message.text())) errors.push(message.text()); });
    await mockApis(page); await ready(page);
    await page.getByRole("link", { name: "Comparer avec ORBITAL V1" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("orbital-globe-v2")).toHaveCount(0);
    await expect(page.locator(".stage > .relative canvas")).toHaveCount(1);
    await page.goBack(); await expect(page).toHaveURL(/\/lab\/orbital-v2$/);
    await expect.poll(() => page.getByTestId("orbital-globe-v2").getAttribute("data-globe2")).toBeTruthy();
    await expect(page.locator(".stage > .relative canvas")).toHaveCount(1);
    await expect(page.locator(".aura-launcher canvas")).toHaveCount(1);
    expect(errors).toEqual([]);
  });
});

test.describe("V2 tactile parity", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("tap, drag safety, mobile inspector, feed and Settings", async ({ page }) => {
    await mockApis(page, { clusters: [conflict], feedItems: [locatedFeed] });
    await page.goto("/lab/orbital-v2"); const canvas = page.getByTestId("orbital-globe-v2");
    await expect.poll(() => canvas.getAttribute("data-globe2")).toBeTruthy();
    const bounds = (await canvas.boundingBox())!; const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y + 30, { steps: 8 }); await page.mouse.up();
    await expect(page.locator(".mobile-sheet")).toHaveCount(0);
    await expect.poll(async () => (await state(page)).target.latDeg).not.toBe(CENTER.lat);
    const beforePinch = (await state(page)).distanceM;
    const touch = await page.context().newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 35, y }, { x: x + 35, y }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 65, y }, { x: x + 65, y }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(async () => (await state(page)).distanceM).toBeLessThan(beforePinch * 0.8);
    await expect(page.locator(".mobile-sheet")).toHaveCount(0);
    await page.getByRole("button", { name: "Vue globale initiale" }).tap();
    await expect.poll(async () => { const current = await state(page); return current.command === null
      && Math.abs(current.target.latDeg - CENTER.lat) < 1e-6 && Math.abs(current.target.lonDeg - CENTER.lon) < 1e-6; }).toBe(true);
    await page.touchscreen.tap(x, y);
    await expect(page.getByRole("region", { name: "Zone signalée : Zone V2 (fixture)", exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: "Flux", exact: true }).tap();
    await expect(page.locator(".mobile-sheet")).toContainText("Séisme de test M5.1");
    await page.locator("#settings-trigger-button").tap();
    await expect(page.locator("#settings-dialog")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
