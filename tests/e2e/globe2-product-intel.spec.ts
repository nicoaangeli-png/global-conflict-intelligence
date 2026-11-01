import { expect, test } from "@playwright/test";
import sample from "../fixtures/ui-feeds-sample.json";
import { CLUSTER, FEED_ITEMS } from "./fixtures";
import { FEED_CATEGORIES } from "@/types/feeds";

test("Globe2 requests every legacy feed category and exposes source state", async ({ page }) => {
  const requested = new Set<string>();
  await page.route("**/api/events?*", route => route.fulfill({ json: { clusters: [], totalEvents: 0 } }));
  await page.route("**/api/feeds?*", route => {
    const category = new URL(route.request().url()).searchParams.get("category") ?? "";
    requested.add(category);
    const items = FEED_ITEMS.filter(item => item.category === category);
    return route.fulfill({ json: { items, generatedAt: new Date().toISOString(), sources: [{
      sourceId: `test-${category}`, sourceName: `Source ${category}`, category,
      status: category === "shipping" ? "not_configured" : "ok", health: category === "shipping" ? "unconfigured" : "healthy",
      message: null, fetchedAt: null, itemCount: items.length, homepage: "https://example.org", license: null,
    }] } });
  });
  await page.goto("/lab/globe2");
  await expect.poll(() => [...requested].sort()).toEqual([...FEED_CATEGORIES].sort());
  await page.getByRole("group", { name: "Filtrer le flux" }).getByRole("button", { name: "SANTÉ" }).click();
  await expect(page.getByTestId("product-feed-panel")).toContainText("Alerte sanitaire de test en France");
  await page.getByTestId("product-feed-item-test:oms").click();
  await expect(page.getByTestId("product-feed-detail")).toBeVisible();
  await page.getByRole("group", { name: "Filtrer le flux" }).getByRole("button", { name: "TRAFIC MARITIME" }).click();
  await expect(page.getByTestId("product-feed-detail")).toHaveCount(0);
  await page.getByText("ÉTAT DES SOURCES").click();
  await expect(page.getByTestId("product-feed-panel")).toContainText("Non branchée");
});

test("real-source fixtures: Globe2 feed selects a disaster and flies with the new Camera Engine", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/api/events?*", route => route.fulfill({ json: {
    clusters: [CLUSTER], totalEvents: 12, generatedAt: sample.generatedAt,
  } }));
  await page.route("**/api/feeds?*", route => {
    const category = new URL(route.request().url()).searchParams.get("category");
    return route.fulfill({ json: {
      items: sample.items.filter(item => item.category === category),
      sources: [], generatedAt: sample.generatedAt,
    } });
  });
  await page.route("**/api/cluster", route => route.fulfill({ json: { events: [] } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab/globe2");
  await expect(page.getByTestId("land-status")).toContainText("NATURAL EARTH ·", { timeout: 15_000 });
  await expect(page.getByTestId("product-feed-panel")).toBeVisible();
  await page.getByRole("group", { name: "Période du flux" }).getByRole("button", { name: "30 J" }).click();
  await expect(page.getByTestId("product-feed-panel").getByRole("button", { name: /Séisme de magnitude 5.2/ })).toBeVisible();
  await expect(page.getByTestId("product-feed-panel").getByRole("button", { name: /Earthquake in Indonesia/ })).toBeVisible();
  await page.getByTestId("product-debug-toggle").click();
  await page.getByTestId("product-feed-item-usgs:us6000u34e").click();
  await expect(page.getByTestId("product-feed-detail")).toContainText("USGS Earthquake Hazards Program");
  await expect(page.getByTestId("product-feed-detail")).toContainText("Mesure");
  await expect(page.getByTestId("debug-target")).toContainText("-8.1449°, 120.2734°", { timeout: 8_000 });
  await expect(page.getByTestId("debug-height")).toHaveText("4000.0 km", { timeout: 8_000 });
  await page.getByTestId("product-conflict-cluster:test-kyiv").click();
  await expect(page.getByTestId("product-conflict-detail")).toContainText("PRESSE NON CONFIRMÉE");
  await expect(page.getByTestId("debug-target")).toContainText("50.4500°, 30.5200°", { timeout: 8_000 });
  const before = await page.getByTestId("debug-target").innerText();
  await page.mouse.move(750, 450);
  await page.mouse.down(); await page.mouse.move(800, 480, { steps: 5 }); await page.mouse.up();
  await expect(page.getByTestId("debug-target")).not.toHaveText(before);
  expect(errors).toEqual([]);
});

test("Globe2 feed remains usable on mobile", async ({ page }) => {
  await page.route("**/api/events?*", route => route.fulfill({ json: { clusters: [], totalEvents: 0 } }));
  await page.route("**/api/feeds?*", route => route.fulfill({ json: {
    items: sample.items.filter(item => item.category === new URL(route.request().url()).searchParams.get("category")),
    sources: [], generatedAt: sample.generatedAt,
  } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/lab/globe2");
  await expect(page.getByTestId("product-feed-panel")).toBeVisible();
  await page.getByRole("group", { name: "Période du flux" }).getByRole("button", { name: "30 J" }).click();
  await page.getByTestId("product-feed-item-usgs:us6000u34e").click();
  await expect(page.getByTestId("product-feed-detail")).toBeVisible();
  await page.getByTestId("product-feed-toggle").click();
  await expect(page.getByTestId("product-feed-panel")).toHaveCount(0);
  await expect(page.getByTestId("camera-lab-canvas")).toBeVisible();
});

test("direct conflict click opens detail; rotation never selects a signal", async ({ page }) => {
  await page.route("**/api/events?*", route => route.fulfill({ json: {
    clusters: [{ ...CLUSTER, latitude: 20, longitude: 0 }], totalEvents: 12,
  } }));
  await page.route("**/api/feeds?*", route => route.fulfill({ json: {
    items: [], sources: [], generatedAt: new Date().toISOString(),
  } }));
  await page.route("**/api/cluster", route => route.fulfill({ json: { events: [] } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lab/globe2");
  await expect(page.getByTestId("land-status")).toContainText("NATURAL EARTH ·", { timeout: 15_000 });
  await page.mouse.move(720, 450);
  await expect.poll(async () => page.locator("canvas[data-testid=camera-lab-canvas]").evaluate(canvas =>
    (canvas as HTMLCanvasElement).style.cursor)).toBe("pointer");
  await page.mouse.down(); await page.mouse.move(790, 480, { steps: 8 }); await page.mouse.up();
  await expect(page.getByTestId("product-conflict-detail")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("land-status")).toContainText("NATURAL EARTH ·", { timeout: 15_000 });
  await page.mouse.click(720, 450);
  await expect(page.getByTestId("product-conflict-detail")).toContainText("PRESSE NON CONFIRMÉE");
  await expect(page.getByTestId("product-conflict-detail")).toContainText("ENREGISTREMENTS");
});

test.describe("mobile direct picking", () => {
  test.use({ hasTouch: true });
  test("direct feed tap opens provenance on mobile", async ({ page }) => {
    const item = { ...FEED_ITEMS[0], id: "test:direct-feed", lat: 20, lon: 0 };
    await page.route("**/api/events?*", route => route.fulfill({ json: { clusters: [], totalEvents: 0 } }));
    await page.route("**/api/feeds?*", route => route.fulfill({ json: {
      items: new URL(route.request().url()).searchParams.get("category") === "disaster" ? [item] : [],
      sources: [], generatedAt: new Date().toISOString(),
    } }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/lab/globe2");
    await expect(page.getByTestId("land-status")).toContainText("NATURAL EARTH ·", { timeout: 15_000 });
    await page.getByTestId("product-feed-toggle").click();
    await page.touchscreen.tap(195, 422);
    await expect(page.getByTestId("product-feed-detail")).toContainText("USGS (fixture)");
    await expect(page.getByTestId("product-feed-detail")).toContainText("TEST UNIQUEMENT");
  });
});

test("Globe2 remains navigable when optional intelligence APIs fail", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/api/events?*", route => route.fulfill({ status: 503, json: { error: "temporary" } }));
  await page.route("**/api/feeds?*", route => route.fulfill({ status: 503, json: { error: "temporary" } }));
  await page.goto("/lab/globe2");
  await expect(page.getByTestId("camera-lab-canvas")).toBeVisible();
  await expect(page.getByTestId("product-feed-panel")).toContainText("données indisponibles", { timeout: 10_000 });
  await page.getByTestId("destination-france").click();
  await page.getByTestId("product-debug-toggle").click();
  await expect(page.getByTestId("debug-height")).toHaveText("1400.0 km", { timeout: 8_000 });
  expect(pageErrors).toEqual([]);
});
