import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LiveItem } from "@/types/feeds";
import { bearing, formatDuration, sourceVehicleKind, trackDurationMs, trackPoints, vehicleFacts, vehicleHeading, vehicleOf } from "@/components/feeds/vehicleModel";
import { useIntelStore } from "@/store/useIntelStore";

/** Extrait réel réduit de /api/feeds?category=military (voir `_note`). */
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/ui-trajets-sample.json"), "utf8")) as { _note: string; items: LiveItem[] };
const [falcon, casa, tower] = fixture.items;

describe("mobiles militaires : nature et visibilité par défaut", () => {
  it("avions et navires allumés par défaut, calques de référence éteints", () => {
    const s = useIntelStore.getState();
    expect(s.mobilesOn).toEqual({ aircraft: true, vessel: true });
    expect(Object.values(s.layersOn).every((on) => on === false)).toBe(true);
  });

  it("nature du mobile : champ `vehicle` de la source, sinon déduite de la source (AIS = navire)", () => {
    expect(vehicleOf(falcon)).toBe("aircraft");
    expect(vehicleOf({ ...falcon, vehicle: undefined, sourceId: "aisstream-military" })).toBe("vessel");
    expect(vehicleOf({ ...falcon, vehicle: "vessel" })).toBe("vessel");
    expect(vehicleOf({ ...falcon, category: "disaster" })).toBeNull();
    expect(sourceVehicleKind("adsb-lol-military")).toBe("aircraft");
  });
});

describe("trajets observés", () => {
  it("du plus ancien au plus récent, sans doublon de la position courante", () => {
    const pts = trackPoints(falcon);
    expect(pts).toHaveLength(4);
    expect(pts[0].t).toBeLessThan(pts[3].t);
    expect(pts[3]).toMatchObject({ lat: falcon.lat, lon: falcon.lon });
    expect(trackDurationMs(falcon)).toBe(Date.parse("2026-10-19T21:23:39.000Z") - Date.parse("2026-10-19T21:19:11.250Z"));
  });

  it("une seule position (ou pas de `track`) : aucun trajet, aucune erreur", () => {
    expect(trackPoints(tower)).toEqual([]);
    expect(trackDurationMs(tower)).toBeNull();
    expect(trackPoints({ ...casa, track: undefined })).toEqual([]);
    expect(trackPoints({ ...casa, track: [{ lat: 999, lon: 0, at: "x" }] as LiveItem["track"] })).toEqual([]);
  });

  it("cap : publié par la source d'abord ; sinon direction des deux dernières positions observées", () => {
    expect(vehicleHeading(falcon)).toEqual({ deg: 234, from: "source" });
    const derived = vehicleHeading({ ...falcon, summary: "Altitude 40 000 ft" });
    expect(derived?.from).toBe("track");
    // Cap publié 234° (sud-ouest) : la direction observée concorde à quelques degrés près.
    expect(Math.abs(derived!.deg - 234)).toBeLessThan(10);
    expect(vehicleHeading({ ...tower, summary: null })).toBeNull();
    expect(Math.round(bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }))).toBe(90);
  });
});

describe("détail d'un appareil", () => {
  it("indicatif, type, immatriculation, altitude et vitesse lus dans la publication de la source", () => {
    expect(vehicleFacts(falcon)).toEqual({ type: "FA7X", callsign: "EVY07", registration: "A56-002", altitudeFt: 40000, speedKt: 463 });
    expect(vehicleFacts(casa).speedKt).toBe(123);
    expect(vehicleFacts({ ...casa, title: "C212", summary: null, metric: null })).toEqual({ type: null, callsign: null, registration: null, altitudeFt: null, speedKt: null });
  });

  it("durée lisible du trajet", () => {
    expect(formatDuration(trackDurationMs(falcon)!)).toBe("4 min");
    expect(formatDuration(3 * 3600e3 + 5 * 60e3)).toBe("3 h 05");
  });
});
