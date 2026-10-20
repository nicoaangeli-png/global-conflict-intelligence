import { expect, test, type Page } from "@playwright/test";
import { COVERAGE, FEED_ITEMS, NOW, mockApis } from "./fixtures";

const AIRCRAFT = {
  ...FEED_ITEMS[0],
  id: "adsb-lol-military:test01", sourceId: "adsb-lol-military", sourceName: "adsb.lol (fixture)", category: "military", nature: "sensor_measurement",
  title: "C17 — RCH123 — 00-0000 (fixture)", summary: "Altitude 30 000 ft ; vitesse sol 450 kt", url: "https://example.org/", occurredAt: NOW,
  countries: ["FRA"], lat: 47.5, lon: 2.5, caveat: "TEST UNIQUEMENT", vehicle: "aircraft", track: [],
} as unknown as (typeof FEED_ITEMS)[number];

/**
 * Couverture ADS-B / AIS : lignes discrètes dans le menu Calques et la fiche pays,
 * avertissement d'absence non significative quand la couverture est faible.
 * Données FIXTURES (ADS-B élevée, AIS faible).
 */

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const line of await page.locator(".coverage").all()) {
    if (!(await line.isVisible())) continue;
    const bounds = (await line.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
}

test.describe("couverture des capteurs — desktop", () => {
  test("menu Calques : ADS-B élevée, AIS faible avec avertissement, aide dépliable", async ({ page }) => {
    await mockApis(page);
    await page.goto("/");
    await page.getByRole("button", { name: /^Calques/ }).click();
    const menu = page.getByRole("dialog", { name: "Calques" });
    const adsb = menu.locator(".coverage").filter({ hasText: "Couverture ADS-B" });
    const ais = menu.locator(".coverage").filter({ hasText: "Couverture AIS" });
    await expect(adsb).toContainText("ÉLEVÉE");
    await expect(adsb).toContainText("Positions fraîches · Continuité correcte");
    await expect(adsb.locator(".coverage-caveat")).toHaveCount(0);
    await expect(ais).toContainText("FAIBLE");
    await expect(ais.locator(".coverage-caveat")).toHaveText("Absence de navires non significative");
    await expect(menu).not.toContainText(/aucune activité/i);
    await ais.locator("summary").click();
    await expect(ais).toContainText("La couverture indique la qualité de l'observation disponible, pas le niveau réel d'activité.");
    await menu.screenshot({ path: "test-results/coverage-layers-desktop.png" });
  });

  test("fiche pays : couverture de la zone, en anglais aussi", async ({ page }) => {
    await mockApis(page);
    await page.goto("/");
    const search = page.getByRole("combobox", { name: "Rechercher un pays", exact: true }).first();
    await search.fill("France");
    await page.getByRole("button", { name: "France FRA", exact: true }).first().click();
    const panel = page.locator(".right-column");
    await expect(panel.locator(".coverage").filter({ hasText: "Couverture ADS-B (zone)" })).toContainText("ÉLEVÉE");
    await expect(panel.locator(".coverage").filter({ hasText: "Couverture AIS (zone)" })).toContainText("Absence de navires non significative");
    await panel.locator(".coverage").first().scrollIntoViewIfNeeded();
    await panel.screenshot({ path: "test-results/coverage-country-desktop.png" });
    await page.getByRole("button", { name: "EN", exact: true }).click();
    await expect(panel.locator(".coverage").filter({ hasText: "AIS coverage (area)" })).toContainText("Absence of vessels is not meaningful");
  });

  test("détail d'un avion : couverture ADS-B autour de sa position", async ({ page }) => {
    let requested = "";
    await mockApis(page, {
      feedItems: [AIRCRAFT, ...FEED_ITEMS],
      override: async (route, url) => {
        if (url.pathname !== "/api/coverage" || !url.searchParams.has("lat")) return false;
        requested = url.search;
        return route.fulfill({ json: { ...COVERAGE, scope: { kind: "point", id: "47.5,2.5", cells: 9 } } });
      },
    });
    await page.goto("/");
    await page.getByRole("tab", { name: /^Militaire/ }).click();
    await page.locator(".left-column").getByText("C17 — RCH123").first().click();
    const detail = page.locator(".right-column");
    await expect(detail.locator(".coverage").filter({ hasText: "Couverture ADS-B (zone)" })).toContainText("ÉLEVÉE");
    await expect(detail.locator(".coverage").filter({ hasText: "Couverture AIS" })).toHaveCount(0);
    // Point ramené au centre de sa cellule de 5° : une requête partagée par zone.
    expect(requested).toBe("?lat=47.5&lon=2.5");
    await detail.screenshot({ path: "test-results/coverage-aircraft-desktop.png" });
  });

  test("source en panne : couverture « indisponible » avec avertissement", async ({ page }) => {
    await mockApis(page, {
      coverage: { ...COVERAGE, adsb: { ...COVERAGE.adsb, level: "unknown", state: "source_unavailable", score: null, reasonCodes: ["source_unavailable"] } },
    });
    await page.goto("/");
    await page.getByRole("button", { name: /^Calques/ }).click();
    const adsb = page.getByRole("dialog", { name: "Calques" }).locator(".coverage").filter({ hasText: "Couverture ADS-B" });
    await expect(adsb).toContainText("INDISPONIBLE");
    await expect(adsb.locator(".coverage-caveat")).toHaveText("Absence d'avions non significative");
  });

  test("API de couverture en échec : « inconnue », jamais un niveau inventé", async ({ page }) => {
    await mockApis(page, { override: async (route, url) => (url.pathname === "/api/coverage" ? route.fulfill({ status: 500, json: {} }) : false) });
    await page.goto("/");
    await page.getByRole("button", { name: /^Calques/ }).click();
    const ais = page.getByRole("dialog", { name: "Calques" }).locator(".coverage").filter({ hasText: "Couverture AIS" });
    await expect(ais).toContainText("inconnue");
    await expect(ais).toContainText("Absence de navires non significative");
  });
});

test.describe("couverture des capteurs — mobile 360 px", () => {
  test.use({ viewport: { width: 360, height: 844 }, hasTouch: true, deviceScaleFactor: 2 });

  test("fiche pays et calques : lignes lisibles, sans débordement", async ({ page }) => {
    await mockApis(page);
    await page.goto("/");
    const navigation = page.getByRole("navigation", { name: "Navigation principale" });
    await navigation.getByRole("button", { name: "Recherche", exact: true }).click();
    await page.getByRole("combobox", { name: "Rechercher un pays", exact: true }).fill("France");
    await page.getByRole("button", { name: "France FRA", exact: true }).click();
    await page.getByRole("button", { name: "Tous les détails ↑", exact: true }).click();
    const panel = page.locator(".mobile-country-panel");
    await panel.getByText("Activité militaire observée", { exact: true }).click();
    const ais = panel.locator(".coverage").filter({ hasText: "Couverture AIS (zone)" });
    await ais.scrollIntoViewIfNeeded();
    await expect(ais.locator(".coverage-caveat")).toBeVisible();
    await expect(ais).toContainText("Absence de navires non significative");
    await noOverflow(page);
    await page.screenshot({ path: "test-results/coverage-country-mobile.png" });
    await page.getByRole("button", { name: "Fermer le panneau", exact: true }).click();
    await navigation.getByRole("button", { name: "Calques", exact: true }).click();
    const layers = page.locator(".layers-content");
    await expect(layers.locator(".coverage").filter({ hasText: "Couverture ADS-B" })).toContainText("ÉLEVÉE");
    await noOverflow(page);
    await page.screenshot({ path: "test-results/coverage-layers-mobile.png" });
  });
});
