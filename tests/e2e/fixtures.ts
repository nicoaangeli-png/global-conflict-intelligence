import type { Page, Route } from "@playwright/test";

/**
 * API ORBITAL simulées dans le navigateur (`page.route`) : scénarios déterministes,
 * aucun appel Internet, aucune dépendance aux fournisseurs réels. Chaque scénario
 * peut remplacer une route (panne, base vide, AURA non configurée…).
 *
 * Toutes les données ci-dessous sont des FIXTURES DE TEST, jamais des faits.
 */

export const NOW = new Date().toISOString();
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export const FEED_ITEMS = [
  {
    id: "test:seisme", sourceId: "usgs", sourceName: "USGS (fixture)", category: "disaster", nature: "sensor_measurement",
    title: "Séisme de test M5.1", summary: "Fixture de test, pas une donnée réelle.", url: "https://example.org/seisme",
    publishedAt: minutesAgo(30), occurredAt: minutesAgo(35), fetchedAt: NOW, countries: ["JPN"], lat: 35.6, lon: 139.7,
    severity: "moderate", metric: null, caveat: "TEST UNIQUEMENT",
  },
  {
    id: "test:oms", sourceId: "who-don", sourceName: "OMS (fixture)", category: "health", nature: "official_alert",
    title: "Alerte sanitaire de test en France", summary: "Fixture de test.", url: "https://example.org/oms",
    publishedAt: minutesAgo(90), occurredAt: null, fetchedAt: NOW, countries: ["FRA"], lat: 48.85, lon: 2.35,
    severity: null, metric: null, caveat: null,
  },
];

export const SOURCE_STATES = [
  { sourceId: "usgs", sourceName: "USGS (fixture)", category: "disaster", status: "ok", health: "healthy", message: null, fetchedAt: NOW, itemCount: 1, homepage: "https://example.org/", license: null, lastSuccessAt: NOW, newestDataAt: minutesAgo(35), latencyMs: 120, quota: null },
  { sourceId: "who-don", sourceName: "OMS (fixture)", category: "health", status: "ok", health: "healthy", message: null, fetchedAt: NOW, itemCount: 1, homepage: "https://example.org/", license: null, lastSuccessAt: NOW, newestDataAt: minutesAgo(90), latencyMs: 80, quota: null },
];

export const CLUSTER = {
  id: "cluster:test-kyiv", latitude: 50.45, longitude: 30.52, country: "Ukraine", region: "Kyiv", locality: "Kyiv (fixture)",
  eventCount: 12, fatalities: 0, intensity: 0.5, typeCounts: { Battles: 12 }, topType: "Battles",
  confidence: "MEDIA_SIGNAL", confidenceCounts: { MEDIA_SIGNAL: 12 }, firstEventAt: minutesAgo(600), lastEventAt: minutesAgo(60),
  eventIds: [], realShare: 1, geoPrecision: "point",
};

export const STATS = {
  generatedAt: NOW, range: "7d", activeZones: 1, majorZones: 0, events24h: 12, events7d: 12, events30d: 12, fatalitiesRange: 0,
  lastDataUpdate: NOW, lastIngestAt: NOW, dataset: "TEST FIXTURE", totalInStore: 12, connectors: [], daily: [], sources: [],
};

export const EMPTY_STATS = { ...STATS, activeZones: 0, events24h: 0, events7d: 0, events30d: 0, totalInStore: 0, sources: [] };

export const SANCTIONS_LAYER = {
  layerId: "sanctions", title: "Sanctions OFAC par pays d'adresse", sourceName: "OFAC (fixture)", homepage: "https://example.org/",
  license: null, asOf: NOW, fetchedAt: NOW, status: "ok", message: null, caveat: "Fixture de test.",
  features: [{ id: "sanctions:test", name: "Entité de test", countries: ["FRA"], geometry: null, properties: { programs: "TEST" }, url: null }],
};

export type Override = (route: Route, url: URL) => Promise<boolean | void> | boolean | void;

export interface MockOptions {
  /** Remplace le traitement d'une route ; retourner `false` laisse le traitement par défaut. */
  override?: Override;
  clusters?: unknown[];
  stats?: unknown;
  feedItems?: typeof FEED_ITEMS;
  sourceStates?: unknown[];
  auraConfigured?: boolean;
}

export async function mockApis(page: Page, options: MockOptions = {}) {
  const items = options.feedItems ?? FEED_ITEMS;
  const states = options.sourceStates ?? SOURCE_STATES;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (options.override && (await options.override(route, url)) !== false) return;
    switch (url.pathname) {
      case "/api/stream":
        return route.fulfill({ contentType: "text/event-stream", body: "event: ready\ndata: {}\n\n" });
      case "/api/events":
        return route.fulfill({ json: { clusters: options.clusters ?? [CLUSTER], generatedAt: NOW } });
      case "/api/stats":
        return route.fulfill({ json: options.stats ?? STATS });
      case "/api/cluster":
        return route.fulfill({ json: { events: [], cluster: options.clusters?.[0] ?? CLUSTER } });
      case "/api/feeds": {
        const category = url.searchParams.get("category");
        const country = url.searchParams.get("country");
        const scoped = items.filter((item) => (!category || item.category === category) && (!country || item.countries.includes(country)));
        const scopedStates = (states as { category: string }[]).filter((state) => !category || state.category === category);
        return route.fulfill({ json: { items: scoped, sources: scopedStates, generatedAt: NOW } });
      }
      case "/api/agent":
        return route.fulfill({ json: { configured: options.auraConfigured ?? true, limits: { maxMessages: 12, maxUserChars: 2000, perClientPerMinute: 6 } } });
      case "/api/agent/voice":
        return route.fulfill({ json: { configured: false, voices: [] } });
      case "/api/layers":
        if (url.searchParams.get("id") === "sanctions") return route.fulfill({ json: SANCTIONS_LAYER });
        if (url.searchParams.has("id")) return route.fulfill({ status: 503, json: { error: "Source indisponible dans ce test" } });
        return route.fulfill({ json: { layers: [] } });
      case "/api/country":
        return route.fulfill({ status: 503, json: { error: "Indicateurs indisponibles dans ce test" } });
      case "/api/briefing":
        return route.fulfill({ status: 503, json: { error: "Bilan indisponible dans ce test" } });
      default:
        return route.fulfill({ json: {} });
    }
  });
}

/** Réponse NDJSON d'AURA simulée (lignes du protocole serveur). */
export function ndjson(lines: unknown[]) {
  return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}
