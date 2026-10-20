import { beforeEach, describe, expect, it } from "vitest";
import {
  ADSB_MAX_TRACKED_AIRCRAFT,
  ADSB_MAX_TRACK_POINTS,
  ADSB_TRACK_WINDOW_MS,
  adsbTrackStats,
  clearAdsbTracks,
  militarySources,
  parseAdsbMilitary,
} from "@/server/feeds/military";
import { ctx, fixtureJson } from "./feeds-helpers";

describe("adsb.lol — aéronefs militaires", () => {
  beforeEach(() => clearAdsbTracks());

  it("produit une mesure par position fraîche avec titre, altitude, vitesse et pays survolé", () => {
    const items = parseAdsbMilitary(fixtureJson("adsb-lol-mil.json"), ctx());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "adsb-lol-military:ae2125",
      category: "military",
      nature: "sensor_measurement",
      vehicle: "aircraft",
      title: "C27J — C2701 — 07-27010",
      occurredAt: "2026-10-19T16:46:23.423Z",
      countries: ["USA"],
      metric: { label: "Altitude", value: 15950, unit: "ft" },
    });
    expect(items[0].summary).toContain("vitesse sol 219 kt");
    expect(items[0].caveat).toContain("beaucoup d’aéronefs militaires n’émettent pas");
    expect(items[0].caveat).toContain("pays survolé");
    expect(items[0].track).toEqual([{ lat: 40.17635, lon: -123.159735, at: "2026-10-19T16:46:23.423Z" }]);
  });

  it("accumule les positions observées, dans l’ordre, et dédoublonne deux positions identiques", () => {
    const first = fixtureJson("adsb-lol-mil.json");
    parseAdsbMilitary(first, ctx());
    const second = fixtureJson("adsb-lol-mil.json");
    second.now += 60_000;
    second.ac[0].lat += 0.1;
    expect(parseAdsbMilitary(second, ctx())[0].track).toHaveLength(2);
    const duplicate = fixtureJson("adsb-lol-mil.json");
    duplicate.now += 120_000;
    duplicate.ac[0].lat += 0.1;
    const track = parseAdsbMilitary(duplicate, ctx())[0].track!;
    expect(track).toHaveLength(2);
    expect(track.map((point) => point.lat)).toEqual([40.17635, 40.27635]);
    expect(track[0].at < track[1].at).toBe(true);
  });

  it("applique la fenêtre glissante de trois heures et purge les appareils non revus", () => {
    const first = fixtureJson("adsb-lol-mil.json");
    parseAdsbMilitary(first, ctx());
    const muchLater = fixtureJson("adsb-lol-mil.json");
    muchLater.now += ADSB_TRACK_WINDOW_MS + 1;
    muchLater.ac[0].hex = "abcdef";
    muchLater.ac[0].lat += 1;
    parseAdsbMilitary(muchLater, ctx());
    expect(adsbTrackStats()).toEqual({ aircraft: 1, points: 1 });
  });

  it("borne le nombre d’appareils et sous-échantillonne les longues trajectoires", () => {
    const raw = fixtureJson("adsb-lol-mil.json");
    raw.ac = Array.from({ length: ADSB_MAX_TRACKED_AIRCRAFT + 5 }, (_, index) => ({
      ...raw.ac[0],
      hex: index.toString(16).padStart(6, "0"),
      lat: 10 + (index % 100) / 100,
    }));
    parseAdsbMilitary(raw, ctx(false));
    expect(adsbTrackStats().aircraft).toBe(ADSB_MAX_TRACKED_AIRCRAFT);

    clearAdsbTracks();
    let lastTrack = [] as NonNullable<ReturnType<typeof parseAdsbMilitary>[number]["track"]>;
    for (let index = 0; index < ADSB_MAX_TRACK_POINTS + 10; index++) {
      const sample = fixtureJson("adsb-lol-mil.json");
      sample.now += index * 60_000;
      sample.ac[0].lat += index / 10_000;
      lastTrack = parseAdsbMilitary(sample, ctx(false))[0].track!;
    }
    expect(lastTrack.length).toBeLessThanOrEqual(ADSB_MAX_TRACK_POINTS);
    expect(lastTrack.at(-1)?.lat).toBeCloseTo(40.18325);
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

  it("déclare la licence ODbL et limite les collectes à une toutes les 15 s", () => {
    expect(militarySources).toHaveLength(1);
    expect(militarySources[0].ttlMs).toBe(15_000);
    expect(militarySources[0].license).toContain("ODbL");
    expect(militarySources[0].license).toContain("adsb.lol");
  });

  it("rejette un format inattendu", () => {
    expect(() => parseAdsbMilitary({}, ctx())).toThrow(/adsb\.lol/);
  });
});
