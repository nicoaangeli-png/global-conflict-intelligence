import { describe, expect, it } from "vitest";
import { parseCanadaAlerts, parseNhcStorms, parseNwsAlerts, parseWmoAlerts, weatherSources } from "@/server/feeds/weather";
import { ctx, fixtureJson } from "./feeds-helpers";

const weatherCtx = (at = "2026-10-19T16:46:12.000Z") => ({ ...ctx(), fetchedAt: at });

describe("OMM Severe Weather", () => {
  it("garde les alertes CAP en vigueur, mappe la sévérité et construit l'URL CAP réelle", () => {
    const items = parseWmoAlerts(fixtureJson("wmo-all.json"), weatherCtx());
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.severity).sort()).toEqual(["moderate", "severe"]);
    expect(items.map((item) => item.countries[0]).sort()).toEqual(["COL", "ESP"]);
    for (const item of items) {
      expect(item.nature).toBe("official_alert");
      expect(item.url).toMatch(/^https:\/\/severeweather\.wmo\.int\/v2\/cap-alerts\//);
      expect(item.lat).toBeNull();
      expect(item.lon).toBeNull();
      expect(item.summary).toContain("Expiration");
    }
  });

  it("écarte le doublon NWS par identifiant CAP et les alertes expirées ou futures", () => {
    const raw = fixtureJson("wmo-all.json");
    raw.items[0].expires = "2026-10-19 16:00:00";
    raw.items[1].effective = "2026-10-20 10:00:00";
    expect(parseWmoAlerts(raw, weatherCtx())).toEqual([]);
  });
});

describe("US National Weather Service", () => {
  it("conserve les alertes Actual, avec centroïde seulement quand un polygone existe", () => {
    const items = parseNwsAlerts(fixtureJson("nws-alerts.json"), weatherCtx());
    expect(items).toHaveLength(2);
    const withoutGeometry = items.find((item) => item.lat === null);
    const withGeometry = items.find((item) => item.lat !== null);
    expect(withoutGeometry?.countries).toEqual(["USA"]);
    expect(withGeometry?.countries).toEqual(["USA"]);
    expect(withGeometry?.lat).toBeCloseTo(29.21, 1);
    expect(withGeometry?.lon).toBeCloseTo(-81.55, 1);
    expect(items.every((item) => item.severity === "severe")).toBe(true);
    expect(items.every((item) => item.summary?.includes("Expiration"))).toBe(true);
  });

  it("n'inclut pas une alerte expirée ou non Actual", () => {
    const raw = fixtureJson("nws-alerts.json");
    raw.features[0].properties.expires = "2026-10-19T10:00:00Z";
    raw.features[1].properties.status = "Test";
    expect(parseNwsAlerts(raw, weatherCtx())).toEqual([]);
  });
});

describe("Environnement Canada", () => {
  it("ne garde que les avertissements en vigueur, jamais les simples bulletins", () => {
    const items = parseCanadaAlerts(fixtureJson("environment-canada-alerts.json"), weatherCtx("2026-10-19T19:00:00.000Z"));
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.title).toContain("avertissement de vent");
      expect(item.countries).toEqual(["CAN"]);
      expect(item.severity).toBe("moderate");
      expect(item.lat).not.toBeNull();
      expect(item.lon).not.toBeNull();
    }
  });

  it("écarte un avertissement avant sa date de validité", () => {
    expect(parseCanadaAlerts(fixtureJson("environment-canada-alerts.json"), weatherCtx())).toEqual([]);
  });
});

describe("NOAA National Hurricane Center", () => {
  it("expose les cyclones actifs sans inventer une gravité d'impact", () => {
    const items = parseNhcStorms(fixtureJson("nhc-storms.json"), weatherCtx());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "noaa-nhc:ep212026",
      title: "Tempête tropicale Trudy",
      nature: "official_alert",
      severity: null,
      metric: { label: "Vent maximal", value: 50, unit: "kt" },
    });
  });
});

describe("sources météo", () => {
  it("ont quatre états indépendants et un cache de dix minutes", () => {
    expect(weatherSources.map((source) => source.sourceId)).toEqual(["wmo-severe-weather", "nws-alerts", "environment-canada-alerts", "noaa-nhc"]);
    expect(weatherSources.every((source) => source.ttlMs === 10 * 60_000)).toBe(true);
    expect(weatherSources.every((source) => source.homepage.startsWith("https://"))).toBe(true);
    expect(weatherSources.every((source) => source.license)).toBe(true);
  });

  it("rejette les formats inattendus avec une erreur lisible", () => {
    expect(() => parseWmoAlerts({}, weatherCtx())).toThrow(/OMM/);
    expect(() => parseNwsAlerts({}, weatherCtx())).toThrow(/NWS/);
    expect(() => parseCanadaAlerts({}, weatherCtx())).toThrow(/Canada/);
    expect(() => parseNhcStorms({}, weatherCtx())).toThrow(/NHC/);
  });
});
