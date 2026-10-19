import { describe, expect, it } from "vitest";
import { infrastructureSources, parseIodaAlerts, parsePortWatch } from "@/server/feeds/infrastructure";
import { ctx, fixtureJson } from "./feeds-helpers";

const infraCtx = () => ({ ...ctx(), fetchedAt: "2026-10-19T16:46:12.000Z" });

describe("IODA", () => {
  it("produit une mesure par entité et épisode critique, avec pays ISO3 et baisse mesurée", () => {
    const items = parseIodaAlerts(fixtureJson("ioda-alerts.json"), infraCtx());
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.countries[0]).sort()).toEqual(["NLD", "SLV"]);
    const netherlands = items.find((item) => item.countries[0] === "NLD");
    expect(netherlands?.metric).toEqual({ label: "Baisse de connectivité", value: 85.8, unit: "%" });
    expect(items.every((item) => item.nature === "sensor_measurement")).toBe(true);
    expect(items.every((item) => item.caveat === "Mesure automatique de connectivité (IODA) : une baisse peut avoir une cause technique, électrique ou politique")).toBe(true);
  });

  it("dédoublonne deux détecteurs de la même entité au même instant", () => {
    const raw = fixtureJson("ioda-alerts.json");
    const duplicate = structuredClone(raw.data.find((entry: { level: string }) => entry.level === "critical"));
    duplicate.datasource = "autre-capteur";
    duplicate.value = 1;
    raw.data.push(duplicate);
    const items = parseIodaAlerts(raw, infraCtx());
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.id.includes("EU.NL.2984"))?.metric?.value).toBe(99.7);
  });
});

describe("FMI PortWatch", () => {
  it("garde les perturbations déclarées en cours et exige un port ou passage affecté", () => {
    const items = parsePortWatch(fixtureJson("portwatch-disruptions.json"), infraCtx());
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.id).sort()).toEqual(["imf-portwatch:1000000", "imf-portwatch:10000004"]);
    expect(items.every((item) => item.nature === "official_publication")).toBe(true);
    expect(items.every((item) => item.url === "https://portwatch.imf.org/")).toBe(true);
    expect(items.map((item) => item.metric?.value).sort()).toEqual([1, 3]);
  });

  it("inclut un épisode terminé depuis moins de trente jours et attribue son pays explicite", () => {
    const raw = fixtureJson("portwatch-disruptions.json");
    const indonesia = raw.features.find((feature: { attributes: { eventid: number } }) => feature.attributes.eventid === 1558059);
    indonesia.attributes.todate = Date.parse("2026-10-01T00:00:00.000Z");
    const items = parsePortWatch(raw, infraCtx());
    expect(items.find((item) => item.id === "imf-portwatch:1558059")?.countries).toEqual(["IDN"]);
  });

  it("rejette un format inattendu", () => {
    expect(() => parseIodaAlerts({}, infraCtx())).toThrow(/IODA/);
    expect(() => parsePortWatch({}, infraCtx())).toThrow(/PortWatch/);
  });
});

describe("sources infrastructure", () => {
  it("ont un cache de trente minutes et des attributions explicites", () => {
    expect(infrastructureSources.map((source) => source.sourceId)).toEqual(["ioda-outages", "imf-portwatch"]);
    expect(infrastructureSources.every((source) => source.ttlMs === 30 * 60_000)).toBe(true);
    expect(infrastructureSources[0].license).toContain("Georgia Tech");
    expect(infrastructureSources[1].license).toContain("FMI");
  });
});
