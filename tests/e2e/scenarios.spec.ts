import { expect, test, type Page } from "@playwright/test";
import { EMPTY_STATS, mockApis, ndjson, SOURCE_STATES } from "./fixtures";

/**
 * Scénarios réels d'un utilisateur sur ordinateur, avec API simulées : démarrage,
 * globe, flux, fiche pays, calques, événement, AURA, et modes dégradés.
 */

test.use({ viewport: { width: 1440, height: 900 } });

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function openCountry(page: Page, name: string, code: string) {
  const search = page.getByRole("combobox", { name: "Rechercher un pays", exact: true }).first();
  await search.fill(name);
  await page.getByRole("button", { name: `${name} ${code}`, exact: true }).first().click();
}

test.describe("parcours principal", () => {
  test("démarrage : en-tête, globe WebGL et flux récupérés", async ({ page }) => {
    const errors = trackErrors(page);
    await mockApis(page);
    await page.goto("/");
    await expect(page.locator(".app-header .brand")).toHaveText("ORBITAL");
    await expect(page.locator(".stage > .relative canvas")).toBeVisible();
    await expect(page.locator(".left-column")).toContainText("Séisme de test M5.1");
    await expect(page.locator(".left-column")).toContainText("Alerte sanitaire de test en France");
    expect(errors).toEqual([]);
  });

  test("sélection d'un événement du fil : détail affiché avec sa source", async ({ page }) => {
    await mockApis(page);
    await page.goto("/");
    await page.locator(".left-column").getByText("Séisme de test M5.1").first().click();
    await expect(page.locator(".right-column")).toContainText("Séisme de test M5.1");
    await expect(page.locator(".right-column")).toContainText("USGS (fixture)");
  });

  test("fiche pays : ouverte depuis la recherche, sections sourcées", async ({ page }) => {
    await mockApis(page);
    await page.goto("/");
    await openCountry(page, "France", "FRA");
    const panel = page.locator(".right-column");
    await expect(panel).toContainText("France");
    await expect(panel).toContainText("Alerte sanitaire de test en France");
  });

  test("calque de référence : activation puis désactivation", async ({ page }) => {
    await mockApis(page);
    await page.goto("/");
    await page.getByRole("button", { name: /^Calques/ }).click();
    const menu = page.getByRole("dialog", { name: "Calques" });
    await expect(menu).toBeVisible();
    const sanctions = menu.getByRole("checkbox", { name: /Sanctions/ });
    await sanctions.check();
    await expect(sanctions).toBeChecked();
    await sanctions.uncheck();
    await expect(sanctions).not.toBeChecked();
  });

  test("AURA : réponse diffusée (simulée) avec ses sources", async ({ page }) => {
    await mockApis(page, {
      override: async (route, url) => {
        if (url.pathname !== "/api/agent" || route.request().method() !== "POST") return false;
        await route.fulfill({
          contentType: "application/x-ndjson",
          body: ndjson([
            { t: "status", text: "Lecture des flux mondiaux…" },
            { t: "delta", text: "Réponse de test d'AURA, " },
            { t: "delta", text: "diffusée en deux morceaux." },
            { t: "sources", items: [{ title: "Source de test", url: "https://example.org/article" }] },
            { t: "done" },
          ]),
        });
      },
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Parler à AURA", exact: true }).click();
    await page.getByPlaceholder(/Demande à AURA/).fill("Question de test ?");
    await page.getByRole("button", { name: "Envoyer la question" }).click();
    const log = page.getByRole("log", { name: "Conversation avec AURA" });
    await expect(log).toContainText("Réponse de test d'AURA, diffusée en deux morceaux.");
    await expect(log.locator('a[href="https://example.org/article"]')).toHaveAttribute("title", "Source de test");
  });
});

test.describe("modes dégradés", () => {
  test("AURA non configurée : message explicite, le reste de l'application fonctionne", async ({ page }) => {
    const errors = trackErrors(page);
    await mockApis(page, { auraConfigured: false });
    await page.goto("/");
    await page.getByRole("button", { name: "Parler à AURA", exact: true }).click();
    await expect(page.getByText(/Agente non configurée/)).toBeVisible();
    await expect(page.locator(".left-column")).toContainText("Séisme de test M5.1");
    expect(errors).toEqual([]);
  });

  test("OpenAI indisponible : AURA signale l'erreur sans casser l'interface", async ({ page }) => {
    const errors = trackErrors(page);
    await mockApis(page, {
      override: async (route, url) => {
        if (url.pathname !== "/api/agent" || route.request().method() !== "POST") return false;
        await route.fulfill({ contentType: "application/x-ndjson", body: ndjson([{ t: "error", code: "http_503", text: "Service OpenAI indisponible." }]) });
      },
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Parler à AURA", exact: true }).click();
    await page.getByPlaceholder(/Demande à AURA/).fill("Question ?");
    await page.getByRole("button", { name: "Envoyer la question" }).click();
    await expect(page.getByRole("log", { name: "Conversation avec AURA" })).toContainText("Service OpenAI indisponible.");
    await expect(page.locator(".stage > .relative canvas")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("une source externe tombe : signalée, les autres continuent", async ({ page }) => {
    const lastAttemptAt = new Date().toISOString();
    await mockApis(page, {
      sourceStates: [
        ...SOURCE_STATES,
        { sourceId: "gdacs", sourceName: "GDACS (fixture)", category: "disaster", status: "error", health: "unavailable", message: "gdacs.org est injoignable.", fetchedAt: null, itemCount: 0, homepage: "https://example.org/", license: null },
      ],
      override: async (route, url) => {
        if (url.pathname !== "/api/sources/status") return false;
        await route.fulfill({ json: { generatedAt: lastAttemptAt, summary: {}, sources: [{ id: "feed:gdacs", kind: "feed", name: "GDACS (fixture)", category: "disaster", status: "unavailable", lastAttemptAt, lastSuccessAt: SOURCE_STATES[0].lastSuccessAt, newestDataAt: null, dataAgeMs: null, latencyMs: null, itemCount: 0, lastError: "Échec de la dernière collecte.", provenance: { homepage: "https://example.org/", license: null, nature: null }, quota: null }] } });
      },
    });
    await page.goto("/");
    const feed = page.locator(".left-column .feed-panel");
    const indicator = feed.getByRole("button", { name: /Sources · 1 indisponible/ });
    await expect(indicator).toBeVisible();
    await expect(indicator.locator(".status-dot")).toHaveAttribute("data-tone", "warn");
    await expect(feed.locator(".error-note")).toHaveCount(0);
    await expect(feed).not.toContainText("gdacs.org est injoignable.");
    await expect(feed).toContainText("Séisme de test M5.1");
    await indicator.click();
    const dialog = page.getByRole("dialog", { name: "Sources de données" });
    const source = dialog.locator(".source-row").filter({ hasText: "GDACS (fixture)" });
    await expect(source).toContainText("État : Indisponible");
    await expect(source).toContainText("Dernier succès :");
    await expect(source.getByText(/^Dernier succès :/)).not.toContainText("inconnu");
    await expect(source).toContainText("Dernière erreur : Échec de la dernière collecte.");
    await expect(source).toContainText("Message : gdacs.org est injoignable.");
    await expect(source).toContainText("Dernière tentative :");
    await expect(source.getByText(/^Dernière tentative :/)).not.toContainText("inconnue");
    await expect(source.locator(".status-dot")).toHaveAttribute("data-tone", "warn");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(indicator).toBeFocused();
  });

  test("source en retard : signalée avec la date de son dernier succès", async ({ page }) => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    await mockApis(page, {
      sourceStates: [{ ...SOURCE_STATES[0], health: "stale", lastSuccessAt: twoHoursAgo }, SOURCE_STATES[1]],
    });
    await page.goto("/");
    const indicator = page.locator(".left-column .feed-panel").getByRole("button", { name: /Sources · 1 en retard/ });
    await expect(indicator).toBeVisible();
    await indicator.click();
    await expect(page.getByRole("dialog", { name: "Sources de données" }).locator(".source-row").filter({ hasText: "USGS (fixture)" })).toContainText("Dernier succès :");
  });

  test("base de conflits vide (SQLite sans enregistrement) : aucun chiffre inventé", async ({ page }) => {
    const errors = trackErrors(page);
    await mockApis(page, { clusters: [], stats: EMPTY_STATS });
    await page.goto("/");
    await page.getByRole("tab", { name: /^Conflits/ }).click();
    await expect(page.getByText("Aucune source d'incidents vérifiés disponible.")).toBeVisible();
    await expect(page.locator(".stage > .relative canvas")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("erreur réseau sur les flux : message d'indisponibilité, globe intact", async ({ page }) => {
    const errors = trackErrors(page);
    await mockApis(page, {
      override: async (route, url) => {
        if (url.pathname !== "/api/feeds") return false;
        await route.abort("failed");
      },
    });
    await page.goto("/");
    const feed = page.locator(".left-column .feed-panel");
    await expect(feed.getByRole("button", { name: /Sources · .*service.*indisponible/ })).toBeVisible();
    await expect(feed.locator(".error-note")).toHaveCount(0);
    await expect(page.locator(".stage > .relative canvas")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Banque mondiale et Wikidata indisponibles : fiche pays partielle", async ({ page }) => {
    await mockApis(page);
    await page.goto("/");
    await openCountry(page, "France", "FRA");
    const panel = page.locator(".right-column");
    await expect(panel).toContainText("Indicateurs Banque mondiale : service indisponible.");
    await expect(panel).toContainText("Alerte sanitaire de test en France");
  });

  test("ADS-B et AIS indisponibles : aucun mobile ni trajet, application fonctionnelle", async ({ page }) => {
    const errors = trackErrors(page);
    await mockApis(page, {
      sourceStates: [
        ...SOURCE_STATES,
        { sourceId: "adsb-lol-military", sourceName: "adsb.lol (fixture)", category: "military", status: "error", health: "unavailable", message: "adsb.lol est injoignable.", fetchedAt: null, itemCount: 0, homepage: "https://example.org/", license: null },
        { sourceId: "aisstream-military", sourceName: "AISStream (fixture)", category: "military", status: "error", health: "unavailable", message: "Connexion AIS impossible.", fetchedAt: null, itemCount: 0, homepage: "https://example.org/", license: null },
      ],
    });
    await page.goto("/");
    await page.getByRole("tab", { name: /^Militaire/ }).click();
    await expect(page.locator(".left-column .feed-panel").getByRole("button", { name: /Sources · 2 indisponibles/ })).toBeVisible();
    await expect(page.locator(".left-column .feed-panel .error-note")).toHaveCount(0);
    await expect(page.locator(".stage > .relative canvas")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("mobile : le détail des sources reste accessible depuis le fil", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApis(page, {
      sourceStates: [
        ...SOURCE_STATES,
        { sourceId: "gdacs", sourceName: "GDACS (fixture)", category: "disaster", status: "error", health: "unavailable", message: "Collecte temporairement indisponible.", fetchedAt: null, itemCount: 0, homepage: "https://example.org/", license: null },
      ],
    });
    await page.goto("/");
    await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: "Flux" }).click();
    const feed = page.locator(".mobile-sheet .feed-panel");
    const indicator = feed.getByRole("button", { name: /Sources · 1 indisponible/ });
    await expect(indicator).toBeVisible();
    await indicator.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Sources de données" });
    await expect(dialog).toBeVisible();
    await expect(indicator).toHaveAttribute("aria-expanded", "true");
    await expect(dialog.locator(".source-row").filter({ hasText: "GDACS (fixture)" })).toContainText("Message : Collecte temporairement indisponible.");
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
    await expect(indicator).toBeFocused();
  });
});
