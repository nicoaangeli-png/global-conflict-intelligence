import { describe, expect, it } from "vitest";
import { parseEonet, parseGdacs, parseUsgs } from "@/server/feeds/disaster";
import { ctx, fixtureJson } from "./feeds-helpers";

describe("GDACS", () => {
  const items = parseGdacs(fixtureJson("gdacs.json"), ctx());

  it("produit des alertes officielles avec sévérité issue du niveau d'alerte", () => {
    expect(items).toHaveLength(6);
    const red = items.find((i) => i.severity === "severe");
    expect(red).toBeDefined();
    expect(red?.nature).toBe("official_alert");
    expect(red?.title).toContain("alerte rouge");
    expect(items.filter((i) => i.severity === "minor").length).toBe(5);
    for (const i of items) {
      expect(i.id.startsWith("gdacs:")).toBe(true);
      expect(i.category).toBe("disaster");
      expect(i.url).toMatch(/^https:\/\/www\.gdacs\.org\//);
      expect(i.publishedAt).toMatch(/Z$/);
      expect(i.fetchedAt).toBe("2026-10-18T10:00:00.000Z");
    }
  });

  it("garde l'ISO3 fourni, complète par les coordonnées, sinon laisse vide", () => {
    const nga = items.find((i) => i.title.includes("Nigeria"));
    expect(nga?.countries).toEqual(["NGA"]);
    const sea = items.find((i) => i.title.includes("Fiji Islands Region"));
    expect(sea?.countries).toEqual([]);
  });

  it("expose la grandeur mesurée", () => {
    const eq = items.find((i) => i.title.startsWith("Earthquake in Indonesia"));
    expect(eq?.metric).toMatchObject({ label: "Magnitude", unit: "M" });
    expect(eq?.metric?.value).toBeGreaterThan(4);
  });

  it("ne garde qu'un élément par événement (épisode le plus récent)", () => {
    const raw = fixtureJson("gdacs.json");
    const older = structuredClone(raw.features[0]);
    older.properties.datemodified = "2020-01-01T00:00:00";
    older.properties.alertlevel = "Green";
    raw.features.push(older);
    const result = parseGdacs(raw, ctx());
    expect(result).toHaveLength(6);
    expect(result.find((i) => i.id === items[0].id)?.severity).toBe(items[0].severity);
  });

  it("rejette un format inattendu avec un message lisible", () => {
    expect(() => parseGdacs({ nope: true }, ctx())).toThrow(/GDACS/);
  });
});

describe("USGS", () => {
  const items = parseUsgs([fixtureJson("usgs-4.5-day.json"), fixtureJson("usgs-significant-week.json")], ctx());

  it("fusionne les deux flux sans doublon, nature capteur, métrique magnitude", () => {
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const i of items) {
      expect(i.nature).toBe("sensor_measurement");
      expect(i.metric?.label).toBe("Magnitude");
      expect(i.occurredAt).toMatch(/Z$/);
      expect(i.url).toMatch(/^https:\/\/earthquake\.usgs\.gov\//);
    }
  });

  it("attribue le pays par coordonnées et classe la sévérité selon la magnitude", () => {
    const pakistan = items.find((i) => i.title.includes("Khuzdar"));
    expect(pakistan?.countries).toEqual(["PAK"]);
    expect(pakistan?.metric?.value).toBe(5.7);
    expect(pakistan?.severity).toBe("moderate");
    const minor = items.find((i) => (i.metric?.value ?? 9) < 5.5);
    expect(minor?.severity).toBe("minor");
  });

  it("rejette un format inattendu", () => {
    expect(() => parseUsgs([{}], ctx())).toThrow(/USGS/);
  });
});

describe("NASA EONET", () => {
  const items = parseEonet(fixtureJson("eonet.json"), ctx());

  it("prend la dernière position de chaque événement et ne fabrique aucune sévérité", () => {
    expect(items).toHaveLength(3);
    for (const i of items) {
      expect(i.id.startsWith("eonet:EONET_")).toBe(true);
      expect(i.severity).toBeNull();
      expect(i.lat).not.toBeNull();
      expect(i.occurredAt).toMatch(/Z$/);
    }
    const storm = items.find((i) => i.nature === "official_alert");
    expect(storm).toBeDefined();
    expect(storm?.metric?.unit).toBe("kts");
  });

  it("rejette un format inattendu", () => {
    expect(() => parseEonet({}, ctx())).toThrow(/EONET/);
  });
});
