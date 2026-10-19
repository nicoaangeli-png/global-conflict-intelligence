import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FeedsResponse, LiveItem } from "@/types/feeds";
import type { ConflictCluster, ConflictEvent } from "@/types/conflict";
import { aggregateClusters } from "@/lib/clustering/cluster";
import {
  NATURE_LABELS,
  THEMES,
  ageBrightness,
  countryMarkets,
  countrySections,
  defaultPeriod,
  failingSourcesFor,
  flagEmoji,
  inPeriod,
  isLive,
  itemTime,
  itemsForTheme,
  latestDataDate,
  mergeCategoryResults,
  sortChronological,
} from "@/components/feeds/feedModel";
import { activeNatures, clusterBreakdown, clusterSummary, isPointPrecise, natureOfSource, precisionLabel, toggleNature } from "@/components/feeds/conflictModel";
import { relativeTime } from "@/lib/format";

/** Extrait réel réduit de /api/feeds (voir `_note` dans la fixture). */
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/ui-feeds-sample.json"), "utf8")) as FeedsResponse & { _note: string };
const items = fixture.items as LiveItem[];
const byId = (prefix: string) => items.find((i) => i.id.startsWith(prefix))!;
// Horloge figée : 18/10/2026 11:00 UTC (30 min après les éléments GDELT de la fixture).
const NOW = Date.parse("2026-10-18T11:00:00Z");

describe("navigation par thèmes", () => {
  it("propose exactement les thèmes utiles, dans l'ordre demandé (météo regroupée avec les catastrophes)", () => {
    expect(THEMES).toEqual(["all", "conflict", "military", "social", "disaster", "health", "un", "space", "nuclear", "infrastructure", "economy", "uap"]);
    expect(THEMES).not.toContain("weather");
    expect(THEMES.length).toBeLessThanOrEqual(12);
  });

  it("filtre le fil par catégorie ; « Conflits » ne contient aucun élément de flux", () => {
    const all = itemsForTheme(items, "all", NOW);
    // « Tout » = l'actualité : ni cotations/devises, ni lancements futurs.
    expect(all.some((i) => i.category === "economy" || i.nature === "market_quote")).toBe(false);
    expect(all.some((i) => i.id.startsWith("ll2:"))).toBe(false);
    expect(all).toHaveLength(items.length - 3);
    expect(itemsForTheme(items, "space", NOW).map((i) => i.id)).toEqual([byId("ll2:").id]);
    expect(itemsForTheme(items, "conflict")).toEqual([]);
    expect(itemsForTheme(items, "uap").every((i) => i.category === "uap")).toBe(true);
    expect(itemsForTheme(items, "un").length).toBeGreaterThan(0);
  });

  it("choisit une période par défaut adaptée au rythme de publication", () => {
    expect(defaultPeriod("social")).toBe("24h");
    expect(defaultPeriod("un")).toBe("7d");
    expect(defaultPeriod("uap")).toBe("all");
  });
});

describe("vocabulaire de nature", () => {
  it("ne présente jamais la presse ni un témoignage comme confirmés", () => {
    expect(NATURE_LABELS.press_article.fr).toBe("Presse — non confirmé");
    expect(NATURE_LABELS.published_report.fr).toBe("Signalement publié — non vérifié");
    expect(NATURE_LABELS.market_quote.fr).toBe("Cotation");
    expect(NATURE_LABELS.scheduled_event.fr).toBe("Planifié");
  });
});

describe("fraîcheur et période", () => {
  it("marque DIRECT un élément de moins de 2 h, jamais un lancement futur", () => {
    expect(isLive(byId("gdelt-events:5450"), NOW)).toBe(true);
    expect(isLive(byId("un-press"), NOW)).toBe(false);
    expect(isLive(byId("ll2:"), NOW)).toBe(false);
  });

  it("utilise la date propre de l'élément, jamais la date de collecte", () => {
    const un = byId("un-press");
    expect(un.occurredAt).toBeNull();
    expect(itemTime(un)).toBe(un.publishedAt);
    expect(itemTime(un)).not.toBe(un.fetchedAt);
  });

  it("filtre la période dans les deux sens et exclut les éléments sans date sauf « Tout »", () => {
    expect(inPeriod(byId("gdelt-events:5450"), "24h", NOW)).toBe(true);
    expect(inPeriod(byId("un-press"), "24h", NOW)).toBe(false);
    expect(inPeriod(byId("un-press"), "7d", NOW)).toBe(true);
    expect(inPeriod(byId("ll2:"), "7d", NOW)).toBe(false); // lancement dans ~3 semaines
    const undated = { ...byId("un-press"), publishedAt: null, occurredAt: null };
    expect(inPeriod(undated, "30d", NOW)).toBe(false);
    expect(inPeriod(undated, "all", NOW)).toBe(true);
  });

  it("atténue l'éclat avec l'âge", () => {
    expect(ageBrightness(byId("gdelt-events:5450"), NOW)).toBe(1);
    expect(ageBrightness(byId("un-press"), NOW)).toBe(0.4);
  });

  it("trie du plus récent au plus ancien ; le futur passe en tête seulement si demandé", () => {
    const sorted = sortChronological(items, NOW);
    expect(sorted.at(-1)!.id.startsWith("ll2:")).toBe(true);
    const times = sorted.slice(0, -1).map((i) => Date.parse(itemTime(i)!));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(sortChronological(items, NOW, true)[0].id.startsWith("ll2:")).toBe(true);
  });

  it("formate l'heure relative au passé et au futur", () => {
    expect(relativeTime("2026-10-18T10:30:00Z", "fr", NOW)).toBe("il y a 30 min");
    expect(relativeTime("2026-10-18T14:00:00Z", "fr", NOW)).toBe("dans 3 h");
    expect(relativeTime("2026-10-18T14:00:00Z", "en", NOW)).toBe("in 3 h");
  });
});

describe("fusion des réponses et état des sources", () => {
  it("fusionne sans doublon et conserve les catégories en échec", () => {
    const body: FeedsResponse = { generatedAt: fixture.generatedAt, items, sources: fixture.sources };
    const merged = mergeCategoryResults([
      { category: "disaster", ok: true, body },
      { category: "un", ok: true, body: { ...body, generatedAt: "2026-10-18T10:40:00.000Z" } },
      { category: "uap", ok: false, error: "service des flux absent (HTTP 404)" },
    ]);
    expect(merged.items).toHaveLength(items.length);
    expect(merged.sources).toHaveLength(fixture.sources.length);
    expect(merged.failedCategories).toEqual([{ category: "uap", error: "service des flux absent (HTTP 404)" }]);
    expect(merged.generatedAt).toBe("2026-10-18T10:40:00.000Z");
  });

  it("signale les sources en erreur du thème, pas celles non branchées", () => {
    const failing = failingSourcesFor(fixture.sources, "uap").map((s) => s.sourceId);
    expect(failing).toContain("aaro");
    expect(failing).not.toContain("nasa-uap");
    expect(failingSourcesFor(fixture.sources, "disaster")).toEqual([]);
  });

  it("donne la date réelle de la dernière donnée d'une source (pas la collecte, pas le futur)", () => {
    expect(latestDataDate(items, "usgs", NOW)).toBe(byId("usgs").occurredAt);
    expect(latestDataDate(items, "ll2", NOW)).toBeNull();
    expect(latestDataDate(items, "absent", NOW)).toBeNull();
  });
});

describe("fiche pays", () => {
  it("répartit par section sur 24 h et garde le dernier élément plus ancien comme tel", () => {
    const fra = countrySections(items, "FRA", NOW);
    expect(fra.social.recent.map((i) => i.id)).toEqual([byId("gdelt-events:5450").id]);
    expect(fra.uap.recent).toEqual([]);
    expect(fra.uap.older?.id).toBe(byId("geipan").id);
    const sau = countrySections(items, "SAU", NOW);
    expect(sau.health.recent).toEqual([]);
    expect(sau.health.older?.sourceId).toBe("who-don");
    expect(countrySections(items, "DEU", NOW).social).toEqual({ recent: [], older: null });
  });

  it("liste les cotations du pays, indice boursier en premier", () => {
    const usa = countryMarkets(items, "USA");
    expect(usa.map((i) => i.sourceId)).toEqual(["yahoo-indices", "ecb-fx"]);
    expect(usa[0].metric?.unit).toBe("%");
  });

  it("construit le drapeau depuis l'ISO2, rien sinon", () => {
    expect(flagEmoji("FR")).toBe("🇫🇷");
    expect(flagEmoji(null)).toBeNull();
    expect(flagEmoji("-99")).toBeNull();
  });
});

describe("conflits : trois natures jamais additionnées", () => {
  const cluster = {
    eventCount: 10,
    fatalities: 4,
    confidenceCounts: { MEDIA_SIGNAL: 6, REPORTED: 4 },
    typeCounts: { "Media signal": 6, "Thermal anomaly": 1, Battles: 3 },
  } as unknown as ConflictCluster;

  it("sépare presse, détections et incidents ; morts seulement pour les incidents", () => {
    expect(clusterBreakdown(cluster)).toEqual({ press: 6, satellite: 1, verified: 3, fatalities: 4 });
    expect(clusterSummary(cluster, "fr")).toBe("3 incidents vérifiés · 6 articles de presse · 1 détection satellite");
    const pressOnly = { ...cluster, eventCount: 5, confidenceCounts: { MEDIA_SIGNAL: 5 }, typeCounts: { "Media signal": 5 } } as unknown as ConflictCluster;
    expect(clusterBreakdown(pressOnly).fatalities).toBeNull();
  });

  it("classe les sources par unité et refuse de tout masquer", () => {
    expect(natureOfSource({ unit: "media_mention" })).toBe("press");
    expect(natureOfSource({ unit: "incident_record" })).toBe("verified");
    expect(natureOfSource({ unit: "thermal_detection" })).toBe("satellite");
    expect(natureOfSource({ unit: "fictional_record" })).toBeNull();
    const all = ["acled", "gdelt", "ucdp", "firms", "import:csv"];
    expect([...activeNatures(all)].sort()).toEqual(["press", "satellite", "verified"]);
    expect(toggleNature(all, "press")).toEqual(["acled", "ucdp", "import:csv", "firms"]);
    expect(toggleNature(["gdelt"], "press")).toBeNull();
  });

  it("ne dessine pas comme un point précis un foyer localisé au niveau pays ou région", () => {
    expect(isPointPrecise(cluster)).toBe(true); // champ absent = comportement historique
    expect(isPointPrecise({ ...cluster, geoPrecision: "country" } as unknown as ConflictCluster)).toBe(false);
    expect(isPointPrecise({ ...cluster, geoPrecision: "region" } as unknown as ConflictCluster)).toBe(false);
    expect(isPointPrecise({ ...cluster, geoPrecision: "city" } as unknown as ConflictCluster)).toBe(true);
    expect(precisionLabel("country", "fr")).toBe("localisé au niveau pays");
    expect(precisionLabel("city", "fr")).toBeNull();
  });
  it("assigne geoPrecision au cluster selon les événements agrégés", () => {
    const evCountry = {
      id: "e1", latitude: 10, longitude: 20, country: "FRA", region: "", locality: "France",
      eventType: "Battles", subEventType: "", actors: [], fatalities: 0, source: "test",
      sourceUrl: "", sourceDataset: "gdelt", confidence: "MEDIA_SIGNAL",
      eventDate: "2026-10-18T10:00:00Z", updatedAt: "2026-10-18T10:00:00Z",
      geoPrecision: "country"
    } as unknown as ConflictEvent;
    const evCity = { ...evCountry, id: "e2", geoPrecision: "city" } as unknown as ConflictEvent;

    const clustersCountry = aggregateClusters([evCountry], { degrees: 1 });
    expect(clustersCountry[0]?.geoPrecision).toBe("country");

    const clustersMixed = aggregateClusters([evCountry, evCity], { degrees: 1 });
    expect(clustersMixed[0]?.geoPrecision).toBe("city");
  });
});
