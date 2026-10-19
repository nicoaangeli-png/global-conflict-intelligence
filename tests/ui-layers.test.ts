import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LiveItem } from "@/types/feeds";
import type { LayerResponse } from "@/types/layers";
import { LAYER_IDS } from "@/types/layers";
import {
  THEMES,
  THEME_COLORS,
  THEME_LABELS,
  THEME_TAB_LABELS,
  defaultPeriod,
  failingSourcesFor,
  inAllFeed,
  isMajorWeather,
  itemHeading,
  itemsForTheme,
  militaryNow,
  countrySections,
} from "@/components/feeds/feedModel";
import {
  LAYER_ORDER,
  LAYER_STYLE,
  featureAnchor,
  featurePoint,
  featuresInCountry,
  isLayerResponse,
  layerSourceLine,
  lineParts,
  parseLayerCatalog,
  parsePrograms,
  propertyRows,
  sanctionsByCountry,
} from "@/components/layers/layerModel";
import { FEED_CATEGORIES } from "@/types/feeds";

/** Extraits réels réduits de /api/layers et /api/feeds (voir `_note` dans la fixture). */
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/ui-layers-sample.json"), "utf8")) as {
  _note: string;
  nuclear_plants: LayerResponse;
  military_bases: LayerResponse;
  submarine_cables: LayerResponse;
  sanctions: LayerResponse;
  catalog: unknown;
  feeds: LiveItem[];
};
const feeds = fixture.feeds;
const byId = (prefix: string) => feeds.find((i) => i.id.startsWith(prefix))!;
// Horloge figée : 19/10/2026 17:00 UTC (≈ 5 min après l'instantané ADS-B de la fixture).
const NOW = Date.parse("2026-10-19T17:00:00Z");

describe("nouvelles catégories de flux : libellés, couleurs, regroupement", () => {
  it("toutes les catégories ont un libellé et une couleur (plus d'erreur de type ni de plantage)", () => {
    for (const category of FEED_CATEGORIES) {
      expect(THEME_LABELS[category]?.fr).toBeTruthy();
      expect(THEME_LABELS[category]?.en).toBeTruthy();
      expect(THEME_COLORS[category]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("« Catastrophes & météo » couvre les deux catégories ; « Militaire » et « Réseaux » ont leur onglet", () => {
    expect(THEME_TAB_LABELS.disaster.fr).toBe("Catastrophes & météo");
    expect(THEMES).toContain("military");
    expect(THEMES).toContain("infrastructure");
    const disaster = itemsForTheme(feeds, "disaster", NOW, { allWeather: true });
    expect(disaster.every((i) => i.category === "weather" || i.category === "disaster")).toBe(true);
    expect(disaster.length).toBe(feeds.filter((i) => i.category === "weather").length);
    expect(itemsForTheme(feeds, "infrastructure", NOW).map((i) => i.sourceId).sort()).toEqual(["imf-portwatch", "ioda-outages"]);
  });

  it("météo : seules les alertes sévères/extrêmes (ou sans sévérité publiée) par défaut, le reste sur demande", () => {
    const moderate = byId("wmo-severe-weather:");
    expect(moderate.severity).toBe("moderate");
    expect(isMajorWeather(moderate)).toBe(false);
    expect(isMajorWeather(byId("nws:"))).toBe(true);
    expect(isMajorWeather(byId("nhc:"))).toBe(true); // avis de cyclone : sévérité non publiée, jamais masqué
    expect(itemsForTheme(feeds, "disaster", NOW).map((i) => i.id)).not.toContain(moderate.id);
    expect(itemsForTheme(feeds, "disaster", NOW, { allWeather: true }).map((i) => i.id)).toContain(moderate.id);
  });

  it("« Tout » exclut les flux continus (positions d'aéronefs, mesures de connectivité) et la météo mineure", () => {
    expect(inAllFeed(byId("adsb-lol:"), NOW)).toBe(false);
    expect(inAllFeed(byId("ioda:"), NOW)).toBe(false);
    expect(inAllFeed(byId("wmo-severe-weather:"), NOW)).toBe(false);
    // Une perturbation portuaire publiée et une alerte sévère restent de l'actualité.
    expect(inAllFeed(byId("imf-portwatch:"), NOW)).toBe(true);
    expect(inAllFeed(byId("nws:"), NOW)).toBe(true);
  });

  it("Réseaux : période par défaut « Tout » (épisodes portuaires datés de leur début, toujours en cours)", () => {
    expect(defaultPeriod("infrastructure")).toBe("all");
    expect(byId("imf-portwatch:").occurredAt?.startsWith("2026-03-01")).toBe(true);
  });

  it("les sources en échec d'un onglet regroupé sont signalées (météo dans Catastrophes)", () => {
    const sources = [
      { sourceId: "nws-alerts", sourceName: "NWS", category: "weather" as const, status: "error" as const, message: "HTTP 503", fetchedAt: null, itemCount: 0, homepage: "", license: null },
      { sourceId: "adsb-lol-military", sourceName: "adsb.lol", category: "military" as const, status: "ok" as const, message: null, fetchedAt: null, itemCount: 3, homepage: "", license: null },
    ];
    expect(failingSourcesFor(sources, "disaster").map((s) => s.sourceId)).toEqual(["nws-alerts"]);
    expect(failingSourcesFor(sources, "military")).toEqual([]);
  });
});

describe("aéronefs militaires", () => {
  it("lit le cap publié par la source, sans jamais en inventer", () => {
    expect(itemHeading(byId("adsb-lol:0d0943"))).toBe(262);
    expect(itemHeading(byId("adsb-lol:497cd2"))).toBe(90);
    expect(itemHeading(byId("ioda:"))).toBeNull();
    expect(itemHeading({ ...byId("adsb-lol:0d0943"), summary: "Altitude 12 650 ft" })).toBeNull();
  });

  it("« en ce moment » au-dessus d'un pays = position datée de moins d'une heure, pays survolé publié", () => {
    expect(militaryNow(feeds, "MEX", NOW).map((i) => i.id)).toEqual(["adsb-lol:0d0943"]);
    expect(militaryNow(feeds, "MEX", NOW + 2 * 3600e3)).toEqual([]);
    expect(militaryNow(feeds, "FRA", NOW)).toEqual([]);
  });

  it("la fiche pays range météo et réseaux dans leurs sections", () => {
    const usa = countrySections(feeds, "USA", NOW);
    expect(usa.weather.recent.length + (usa.weather.older ? 1 : 0)).toBeGreaterThan(0);
    expect(usa.infrastructure.recent).toEqual([]);
  });
});

describe("calques de référence", () => {
  it("quatre calques, ordre et style sobres (aucune icône, glyphes dessinés)", () => {
    expect([...LAYER_ORDER].sort()).toEqual([...LAYER_IDS].sort());
    expect(LAYER_STYLE.sanctions.glyph).toBe("tint");
    expect(LAYER_STYLE.submarine_cables.glyph).toBe("line");
  });

  it("valide les réponses et lit le catalogue réel", () => {
    expect(isLayerResponse(fixture.nuclear_plants, "nuclear_plants")).toBe(true);
    expect(isLayerResponse(fixture.nuclear_plants, "sanctions")).toBe(false);
    expect(isLayerResponse({ layerId: "nope", features: [] })).toBe(false);
    const catalog = parseLayerCatalog(fixture.catalog);
    expect(catalog.map((l) => l.layerId).sort()).toEqual([...LAYER_IDS].sort());
    expect(catalog.every((l) => l.sourceName && l.caveat)).toBe(true);
    expect(parseLayerCatalog({ layers: [{ layerId: "x" }, null] })).toEqual([]);
  });

  it("positions des installations et tracés des câbles ([lon, lat] → lat/lon)", () => {
    const tricastin = fixture.nuclear_plants.features.find((f) => f.name.includes("Tricastin"))!;
    const p = featurePoint(tricastin)!;
    expect(p.lat).toBeGreaterThan(44);
    expect(p.lat).toBeLessThan(45);
    expect(p.lon).toBeGreaterThan(4);
    expect(p.lon).toBeLessThan(5);
    const cable = fixture.submarine_cables.features[0];
    expect(featurePoint(cable)).toBeNull();
    expect(lineParts(cable).map((part) => part.length)).toEqual([2, 19]);
    expect(featureAnchor(cable)).toEqual({ lat: -5.366704978908298, lon: 106.16405663257127 });
  });

  it("sanctions par pays : nombre d'entités et programmes de la source, rien d'ajouté", () => {
    const map = sanctionsByCountry(fixture.sanctions.features);
    expect(map.get("IRN")?.entities).toBe(1705);
    expect(map.get("FRA")?.entities).toBe(48);
    expect(map.get("IRN")?.programs[0]).toEqual({ name: "IFSR", count: 753 });
    expect(map.has("USA")).toBe(false);
    expect(parsePrograms("SDGT; IRAN")).toEqual([
      { name: "SDGT", count: null },
      { name: "IRAN", count: null },
    ]);
    expect(parsePrograms("{cassé")).toEqual([]);
  });

  it("installations d'un pays : rattachement publié par la source uniquement", () => {
    expect(featuresInCountry(fixture.nuclear_plants.features, "FRA").map((f) => f.name)).toEqual(["centrale nucléaire du Tricastin", "Phénix"]);
    expect(featuresInCountry(fixture.military_bases.features, "FRA")).toEqual([]);
  });

  it("attributs bruts lisibles ; le repère de carte TeleGeography n'est pas présenté comme un atterrissement", () => {
    const rows = propertyRows(fixture.nuclear_plants.features[0], "fr");
    expect(rows.find((r) => r.key === "operator")?.value).toBe("Pakistan Atomic Energy Commission");
    expect(rows.find((r) => r.key === "closureDate")).toBeUndefined(); // null : non affiché, jamais « Inconnu »
    const cableRows = propertyRows(fixture.submarine_cables.features[0], "fr");
    expect(cableRows.find((r) => r.key === "color")).toBeUndefined();
    expect(cableRows.find((r) => r.key === "landingPoint")?.label).toBe("Repère de la carte source");
    const programs = propertyRows(fixture.sanctions.features.find((f) => f.id === "sanctions:FRA")!, "fr").find((r) => r.key === "programs")!;
    expect(programs.value).toMatch(/^RUSSIA-EO14024 \(21\), SDGT \(14\)/);
  });

  it("ligne de légende : date de la donnée distincte de la collecte, absence dite honnêtement", () => {
    const fmt = (iso: string) => iso.slice(0, 10);
    expect(layerSourceLine(fixture.sanctions, "fr", fmt)).toBe(`U.S. Treasury OFAC — SDN List · donnée du 2026-10-16 · collecte ${fixture.sanctions.fetchedAt.slice(0, 10)}`);
    expect(layerSourceLine(fixture.nuclear_plants, "fr", fmt)).toContain("date de la donnée non publiée par la source");
  });
});
