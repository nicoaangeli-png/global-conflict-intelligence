import { test, expect, type Page } from "@playwright/test";
import type { DetectionResponse, OrbitalEvent } from "../src/types/detection";

const timestamp = "2026-10-20T10:00:00Z";

function fixtureEvent(id = "test:priority", precision: "point" | "country" = "point"): OrbitalEvent {
  return {
    id, title: id === "test:priority" ? "Priority test fixture" : "Small test fixture", kind: "incident",
    firstReceivedAt: timestamp, lastReceivedAt: timestamp, occurredAt: null,
    position: { lat: 48, lon: 2, precision }, place: "Test place", countries: ["FRA"],
    confidenceScore: 42, confidence: { score: 42, status: "watch", factors: [{ code: "test", points: 42, detail: "Test factor only" }], confirmationBasis: null, caveats: ["Test caveat only"], version: 1 },
    importanceScore: 30, importanceReasons: [], status: "watch", independentSourceCount: 1, distinctProviderCount: 2, evidenceCount: 3,
    contradictions: ["Test contradiction only"], evidenceTruncated: true,
    timeline: [{ at: timestamp, type: "first_signal", signalId: "test:signal", confidenceScore: 42, status: "watch", independentSourceCount: 1 }],
    evidence: [{ canonicalUrl: "javascript:alert(1)", domain: "example.org", fingerprint: "test", independenceGroup: "same-dispatch", dependenceReasons: ["Shared dispatch"], signal: {
      id: "test:signal", provider: "test-provider", sourceName: "Test source", url: "https://example.org/test", title: "Test evidence only", text: null,
      kind: "incident", nature: "press", occurredAt: null, publishedAt: timestamp, receivedAt: timestamp,
      position: null, place: null, countries: [], entities: [], upstreamAgency: "Test agency", confirmsOccurrence: false, severity: null, metric: null, caveat: "Press is not confirmation",
    } }],
  };
}

async function fixtureApis(page: Page, detection: () => DetectionResponse | null) {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/detection") {
      const body = detection();
      await route.fulfill(body ? { json: body } : { status: 503, json: {} });
      return;
    }
    if (pathname === "/api/stream") { await route.fulfill({ contentType: "text/event-stream", body: "event: ready\ndata: {}\n\n" }); return; }
    const responses: Record<string, unknown> = {
      "/api/events": { clusters: [], generatedAt: timestamp },
      "/api/stats": { generatedAt: timestamp, range: "7d", activeZones: 0, majorZones: 0, events24h: 0, events7d: 0, events30d: 0, fatalitiesRange: 0, lastDataUpdate: null, lastIngestAt: null, dataset: "TEST FIXTURE", totalInStore: 0, connectors: [], daily: [] },
      "/api/feeds": { items: [], sources: [], generatedAt: timestamp }, "/api/layers": { layers: [] }, "/api/agent": { configured: false },
    };
    await route.fulfill({ json: responses[pathname] ?? {} });
  });
}

test("detection details refresh, keyboard containment, stale state and smaller signals", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  let current: DetectionResponse | null = { generatedAt: timestamp, status: "ok", events: [fixtureEvent(), fixtureEvent("test:small", "country")], live: [fixtureEvent()] };
  let requests = 0;
  await fixtureApis(page, () => { requests++; return current; });
  await page.clock.install();
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Priority test fixture/ })).toBeVisible();
  await page.clock.runFor(400);
  const stripBounds = await page.locator(".detection-strip").boundingBox();
  const columnBounds = await page.locator(".left-column").boundingBox();
  expect(columnBounds!.y).toBeGreaterThanOrEqual(stripBounds!.y + stripBounds!.height);
  await page.getByRole("button", { name: /Priority test fixture/ }).click();
  const dialog = page.getByRole("dialog", { name: "Détail de détection" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Fournisseurs distincts");
  await expect(dialog).toContainText("Sources indépendantes");
  await expect(dialog).toContainText("Test contradiction only");
  await expect(dialog).toContainText("Liste de preuves tronquée");
  await expect(dialog.getByRole("link", { name: /Ouvrir la source/ })).toHaveAttribute("href", "https://example.org/test");
  await expect(dialog).toContainText("Occurrence: Date inconnue");
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("link")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Fermer la détection" })).toBeFocused();
  current = { ...current!, events: current!.events.map((event) => event.id === "test:priority" ? { ...event, title: "Updated test fixture", confidenceScore: 58 } : event), live: [] };
  await page.clock.fastForward(31_000);
  await expect(dialog).toContainText("Updated test fixture");
  await expect(dialog).toContainText("58/100");
  expect(requests).toBe(2);
  current = null;
  await page.clock.fastForward(31_000);
  await expect(dialog).toContainText("peuvent être périmées");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Tous les signaux \(2\)/ })).toBeFocused();
  await page.getByRole("button", { name: /Tous les signaux \(2\)/ }).click();
  await page.getByRole("button", { name: /Small test fixture/ }).click();
  await expect(page.getByRole("dialog")).toContainText("aucun recentrage du globe");
  await expect(page.getByRole("button", { name: "Localiser sur le globe" })).toHaveCount(0);
  current = { generatedAt: timestamp, status: "ok", events: [], live: [] };
  await page.clock.fastForward(31_000);
  await expect(page.getByRole("dialog")).toContainText("n’est plus présent");
});

for (const width of [360, 768]) {
  test(`detection avoids mobile header, navigation and sheets at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await fixtureApis(page, () => ({ generatedAt: timestamp, status: "ok", events: [fixtureEvent()], live: [fixtureEvent()] }));
    await page.goto("/");
    const strip = page.getByRole("region", { name: "Détection ORBITAL" });
    await expect(strip).toBeVisible();
    const headerBounds = await page.locator(".app-header").boundingBox();
    const stripBounds = await strip.boundingBox();
    expect(stripBounds!.y).toBeGreaterThanOrEqual(headerBounds!.y + headerBounds!.height);
    expect(stripBounds!.x + stripBounds!.width).toBeLessThanOrEqual(width);
    await page.getByRole("button", { name: /Priority test fixture/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const dialogBounds = await dialog.boundingBox();
    const navBounds = await page.locator(".mobile-nav").boundingBox();
    expect(dialogBounds!.y).toBeGreaterThanOrEqual(headerBounds!.y + headerBounds!.height);
    expect(dialogBounds!.y + dialogBounds!.height).toBeLessThanOrEqual(navBounds!.y);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`detection-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /Priority test fixture/ })).toBeFocused();
    await page.getByRole("navigation").getByRole("button", { name: "Flux", exact: true }).click();
    await expect(strip).toBeHidden();
    await expect(page.locator(".mobile-sheet")).toBeVisible();
    await page.getByRole("navigation").getByRole("button", { name: "Monde", exact: true }).click();
    await expect(strip).toBeVisible();
    await page.getByRole("button", { name: "Paramètres", exact: true }).click();
    await expect(strip).toBeHidden();
  });
}

test("English empty state remains honest", async ({ page }) => {
  await fixtureApis(page, () => ({ generatedAt: timestamp, status: "ok", events: [], live: [] }));
  await page.goto("/");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("button", { name: "All signals (0)", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "All signals" })).toContainText("does not establish the absence of events");
});

test("initial unavailable response does not claim no events", async ({ page }) => {
  await fixtureApis(page, () => null);
  await page.goto("/");
  await expect(page.locator(".detection-health")).toContainText("Indisponible");
  await page.getByRole("button", { name: "Tous les signaux", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Aucune réponse disponible");
  await expect(page.getByRole("dialog")).not.toContainText("Aucun signal dans cette réponse");
});
