import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMilitaryBasesQuery, loadLayer, parseSanctions, parseSubmarineCables, parseMilitaryBases, parseNuclearPlants, resetLayersCache } from "@/server/layers";
import { publicationDateFromUrl } from "@/server/layers/sanctions";

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", "layers", name), "utf8");
const nuclear = JSON.parse(fixture("wikidata-nuclear.json")).results.bindings;
const military = JSON.parse(fixture("wikidata-military.json")).results.bindings;

beforeEach(() => resetLayersCache());
afterEach(() => vi.unstubAllGlobals());

describe("parseurs de calques de référence", () => {
  it("conserve les centrales, ISO3 et statuts explicitement sourcés", () => {
    const features = parseNuclearPlants(nuclear, Date.parse("2026-10-19T00:00:00Z"));
    expect(features).toHaveLength(3);
    expect(features[0]).toMatchObject({ id: "nuclear_plants:Q100", countries: ["FRA"], geometry: { coordinates: [2.35, 48.85] }, properties: { operator: "Opérateur & Co", status: "en service", capacity: 900 } });
    expect(features.map((f) => f.properties.status)).toEqual(["en service", "fermée", "en construction"]);
  });

  it("classe les bases par sitelinks, dérive leur type P31 et écarte les fermées", () => {
    const features = parseMilitaryBases(military);
    expect(features.map((feature) => feature.id)).toEqual(["military_bases:Q204", "military_bases:Q200", "military_bases:Q205"]);
    expect(features.map((feature) => feature.properties.type)).toEqual(["navale", "aérienne", "terrestre"]);
    expect(features[1]).toMatchObject({ countries: ["FRA", "USA"], properties: { operator: "Forces armées françaises", sitelinks: 40 } });
  });

  it("demande des casernes notables et une pagination ordonnée par sitelinks", () => {
    const query = buildMilitaryBasesQuery({ qid: "Q131263", type: "terrestre", minSitelinks: 5 }, 250, 250);
    expect(query).toContain("VALUES ?type { wd:Q131263 }");
    expect(query).toContain("wikibase:sitelinks ?sitelinksValue");
    expect(query).toContain("FILTER(?sitelinksValue >= 5)");
    expect(query).toContain("ORDER BY DESC(?sitelinks)");
    expect(query).toContain("LIMIT 250");
    expect(query).toContain("OFFSET 250");
  });

  it("préserve les lignes de câbles et ne déduit pas de pays d'un tracé", () => {
    const features = parseSubmarineCables(JSON.parse(fixture("cables.geojson")));
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ id: "submarine_cables:fr-test", name: "France & Test", countries: [], geometry: { type: "MultiLineString" } });
  });

  it("agrège OFAC par pays d'adresse et programme sans doubler une entité", async () => {
    const features = await parseSanctions(fixture("sdn.csv"), fixture("add.csv"));
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ id: "sanctions:FRA", countries: ["FRA"], geometry: null, properties: { entityCount: 1 } });
    expect(features[0].properties.programs).toBe('{"IRAN":1,"RUSSIA-EO14024":1}');
  });

  it("lit la date de publication OFAC dans l'URL officielle redirigée", () => {
    expect(publicationDateFromUrl("https://bucket/Published/id/2026-10-16/file/SDN.CSV")).toBe("2026-10-16");
  });
});

describe("cache de 24 h et repli stale", () => {
  it("n'appelle pas la source dans les 24 h et sert le dernier cache valide en panne", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "orbital-layers-"));
    let now = Date.parse("2026-10-19T00:00:00.000Z");
    const fetchMock = vi.fn(async () => new Response(fixture("wikidata-nuclear.json"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const first = await loadLayer("nuclear_plants", { cacheDir: directory, now: () => now });
    expect(first.status).toBe("ok");
    expect(first.features).toHaveLength(3);
    await loadLayer("nuclear_plants", { cacheDir: directory, now: () => now + 60_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resetLayersCache();
    now += 25 * 60 * 60 * 1000;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const stale = await loadLayer("nuclear_plants", { cacheDir: directory, now: () => now });
    expect(stale.status).toBe("stale");
    expect(stale.features).toHaveLength(3);
    expect(stale.message).toMatch(/dernier cache valide/i);
  });
});
