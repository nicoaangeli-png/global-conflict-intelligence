import { test, expect, type Page } from "@playwright/test";

async function fixtureApis(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const now = new Date().toISOString();
    let body: unknown = {};
    if (url.pathname === "/api/stream") {
      await route.fulfill({ contentType: "text/event-stream", body: "event: ready\ndata: {}\n\n" });
      return;
    }
    if (url.pathname === "/api/events") body = { clusters: [], generatedAt: now };
    if (url.pathname === "/api/stats") body = {
      generatedAt: now, range: "7d", activeZones: 0, majorZones: 0,
      events24h: 0, events7d: 0, events30d: 0, fatalitiesRange: 0,
      lastDataUpdate: now, lastIngestAt: now, dataset: "TEST FIXTURE",
      totalInStore: 0, connectors: [], daily: [],
    };
    if (url.pathname === "/api/feeds") body = {
      items: url.searchParams.get("category") === "disaster" ? [{
        id: "test:mobile", category: "disaster", nature: "official_alert",
        title: "Événement de test mobile", summary: "Fixture de test, pas une donnée réelle.",
        url: null, sourceId: "test", sourceName: "Fixture", publishedAt: now,
        occurredAt: now, fetchedAt: now, countries: ["FRA"], lat: 48.8, lon: 2.3,
        severity: "info", metric: null, caveat: "TEST UNIQUEMENT",
      }] : [], sources: [], generatedAt: now,
    };
    if (url.pathname === "/api/agent") body = { configured: false };
    if (url.pathname === "/api/layers") {
      if (url.searchParams.has("id")) {
        await route.fulfill({ status: 503, json: { error: "Source indisponible dans ce test" } });
        return;
      }
      body = { layers: [] };
    }
    if (url.pathname === "/api/country") {
      await route.fulfill({ status: 503, json: { error: "Indicateurs indisponibles dans ce test" } });
      return;
    }
    await route.fulfill({ json: body });
  });
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const sheet = page.locator(".mobile-sheet");
  if (await sheet.isVisible()) {
    const bounds = await sheet.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
}

for (const width of [360, 375, 390, 430, 768]) {
  test.describe(`${width}px tactile`, () => {
    test.use({ viewport: { width, height: width === 768 ? 1024 : 844 }, hasTouch: true, deviceScaleFactor: 2 });
    test("paramètres visibles, lisibles et refermables", async ({ page }) => {
      await fixtureApis(page);
      await page.goto("/");
      const trigger = page.getByRole("button", { name: "Paramètres", exact: true });
      await expect(trigger.locator(".settings-trigger-label")).toBeVisible();
      const brandBounds = await page.locator(".app-header .brand").boundingBox();
      const toolsBounds = await page.locator(".mobile-tools summary").boundingBox();
      expect(brandBounds!.x + brandBounds!.width).toBeLessThanOrEqual(toolsBounds!.x);
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Paramètres · Sources & déploiement", exact: true });
      await expect(dialog).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      const close = dialog.getByRole("button", { name: "Fermer les paramètres", exact: true });
      await expect(close).toBeFocused();
      await expect(page.locator(".globe-dock")).toBeHidden();
      for (const viewport of [{ width, height: 844 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);
        const bounds = await dialog.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
        expect(bounds!.y).toBeGreaterThanOrEqual(0);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
        await dialog.locator(".settings-content").evaluate((element) => { element.scrollTop = element.scrollHeight; });
        await expect(dialog.getByText("Règle appliquée dans tout le système", { exact: false })).toBeInViewport();
        await expect(close).toBeInViewport();
        await noOverflow(page);
      }
      await close.click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(page.locator(".globe-dock")).toBeVisible();
      await trigger.click();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await page.getByRole("button", { name: "EN", exact: true }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Settings · Sources & Deployment", exact: true })).toBeVisible();
    });
    test("navigation, pays, événement, calques, AURA et orientation", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await fixtureApis(page);
      await page.goto("/");
      const navigation = page.getByRole("navigation", { name: "Navigation principale" });
      await expect(navigation).toBeVisible();
      await expect(page.locator(".stage > .relative canvas")).toBeVisible();
      for (const button of await navigation.getByRole("button").all()) {
        const bounds = await button.boundingBox();
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
        expect(bounds!.width).toBeGreaterThanOrEqual(44);
      }
      await noOverflow(page);
      await navigation.getByRole("button", { name: "Recherche", exact: true }).click();
      await page.getByRole("combobox", { name: "Rechercher un pays", exact: true }).fill("France");
      await page.getByRole("button", { name: "France FRA", exact: true }).click();
      await expect(page.locator(".mobile-sheet")).toHaveAttribute("data-expanded", "false");
      await expect(page.locator(".mobile-country-panel")).toContainText("France");
      await page.getByRole("button", { name: "Tous les détails ↑", exact: true }).click();
      await expect(page.locator(".mobile-sheet")).toHaveAttribute("data-expanded", "true");
      await expect(page.locator(".mobile-country-secondary").first()).not.toHaveAttribute("open");
      await noOverflow(page);
      await page.getByRole("button", { name: "Fermer le panneau", exact: true }).click();
      await expect(page.locator(".mobile-sheet")).toHaveCount(0);
      await navigation.getByRole("button", { name: "Flux", exact: true }).click();
      await page.getByRole("button").filter({ hasText: "Événement de test mobile" }).click();
      await expect(page.locator(".mobile-sheet")).toHaveAttribute("data-expanded", "false");
      await expect(page.locator(".mobile-sheet")).toContainText("Événement de test mobile");
      await navigation.getByRole("button", { name: "Calques", exact: true }).click();
      await expect(page.locator(".layers-content")).toBeVisible();
      const checkbox = page.locator(".layers-content input[type=checkbox]").first();
      await checkbox.check();
      await expect(checkbox).toBeChecked();
      await noOverflow(page);
      await page.keyboard.press("Escape");
      await expect(page.locator(".mobile-sheet")).toHaveCount(0);
      await navigation.getByRole("button", { name: "AURA", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "AURA", exact: true })).toBeVisible();
      const composer = page.locator(".aura-composer textarea");
      await composer.fill("Question conservée");
      await expect(composer).toBeFocused();
      await page.setViewportSize({ width, height: 500 });
      await expect.poll(async () => (await composer.boundingBox())!.y + (await composer.boundingBox())!.height).toBeLessThan(500);
      await noOverflow(page);
      await page.getByRole("button", { name: "Fermer AURA", exact: true }).click();
      await navigation.getByRole("button", { name: "AURA", exact: true }).click();
      await expect(composer).toHaveValue("Question conservée");
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 844, height: 390 });
      await navigation.getByRole("button", { name: "Recherche", exact: true }).click();
      await noOverflow(page);
      await page.getByRole("button", { name: "Fermer le panneau", exact: true }).click();
      await page.locator("#settings-trigger-button").click();
      await expect(page.locator("#settings-dialog")).toBeVisible();
      await noOverflow(page);
      expect(errors).toEqual([]);
    });
  });
}

test("desktop conserve ses colonnes et sa recherche", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixtureApis(page);
  await page.goto("/");
  await expect(page.locator(".left-column")).toBeVisible();
  await expect(page.locator(".header-search")).toBeVisible();
  await expect(page.locator(".mobile-nav")).toBeHidden();
  await noOverflow(page);
});
