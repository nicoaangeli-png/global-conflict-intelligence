import { describe, expect, it } from "vitest";
import { militarySources, parseAdsbMilitary } from "@/server/feeds/military";
import { ctx, fixtureJson } from "./feeds-helpers";

describe("adsb.lol — aéronefs militaires", () => {
  it("produit une mesure par position fraîche avec titre, altitude, vitesse et pays survolé", () => {
    const items = parseAdsbMilitary(fixtureJson("adsb-lol-mil.json"), ctx());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "adsb-lol-military:ae2125",
      category: "military",
      nature: "sensor_measurement",
      title: "C27J — C2701 — 07-27010",
      occurredAt: "2026-10-19T16:46:23.423Z",
      countries: ["USA"],
      metric: { label: "Altitude", value: 15950, unit: "ft" },
    });
    expect(items[0].summary).toContain("vitesse sol 219 kt");
    expect(items[0].caveat).toContain("beaucoup d’aéronefs militaires n’émettent pas");
    expect(items[0].caveat).toContain("pays survolé");
  });

  it("ignore une position vieille de plus de cinq minutes ou absente", () => {
    const raw = fixtureJson("adsb-lol-mil.json");
    raw.ac[0].seen_pos = 301;
    expect(parseAdsbMilitary(raw, ctx())).toEqual([]);
  });

  it("utilise `seen` lorsque `seen_pos` est absent", () => {
    const raw = fixtureJson("adsb-lol-mil.json");
    delete raw.ac[0].seen_pos;
    raw.ac[0].seen = 12;
    expect(parseAdsbMilitary(raw, ctx())[0].occurredAt).toBe("2026-10-19T16:46:11.794Z");
  });

  it("déclare la licence ODbL et un cache de deux minutes", () => {
    expect(militarySources).toHaveLength(1);
    expect(militarySources[0].ttlMs).toBe(2 * 60_000);
    expect(militarySources[0].license).toContain("ODbL");
    expect(militarySources[0].license).toContain("adsb.lol");
  });

  it("rejette un format inattendu", () => {
    expect(() => parseAdsbMilitary({}, ctx())).toThrow(/adsb\.lol/);
  });
});
