import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { SensorCoverage, SensorType } from "@/types/coverage";
import { ADSB_PARAMS, AIS_PARAMS, CAPS, LEVEL_THRESHOLDS, computeCoverage, levelFromScore, type SourceAvailability } from "@/server/coverage/score";
import { cellsAround, cellsInBox, clearCoverageObservations, recordObservation, sensorStore } from "@/server/coverage/observations";
import { countryCoverageCells, sourceAvailability } from "@/server/coverage";
import { cellOf } from "@/server/coverage/observations";
import { loadWorldIndex } from "@/server/world";
import { recordAdsbCoverage } from "@/server/feeds/military";
import { aisTimeUtc } from "@/server/feeds/maritime";
import { COVERAGE_HELP, LEVEL_LABELS, REASON_LABELS, coverageLevelLabel } from "@/lib/coverage";
import { CoverageLine } from "@/components/coverage/CoverageLine";

const NOW = Date.parse("2026-10-20T12:00:30.000Z");
const MIN = 60_000;

/** Points répartis sur une grille large (≈ 40 cellules distinctes de 5°). */
const SPREAD = Array.from({ length: 40 }, (_, i) => ({ lat: -30 + (i % 8) * 8, lon: -100 + Math.floor(i / 8) * 40 }));

interface Scenario {
  sensor: SensorType;
  /** Première minute de réception, en minutes avant NOW. */
  fromMinutesAgo: number;
  /** Dernière minute de réception, en minutes avant NOW (0 = maintenant). */
  toMinutesAgo?: number;
  perMinute: number;
  /** Délai émission → réception publié par la source (null = non publié). */
  lagMs?: number | null;
  points?: { lat: number; lon: number }[];
  /** Une minute sur `every` seulement. */
  every?: number;
}

function feed({ sensor, fromMinutesAgo, toMinutesAgo = 0, perMinute, lagMs = 5_000, points = SPREAD, every = 1 }: Scenario) {
  const freshLag = sensor === "adsb" ? ADSB_PARAMS.freshLagMs : AIS_PARAMS.freshLagMs;
  for (let m = fromMinutesAgo; m >= toMinutesAgo; m--) {
    if ((fromMinutesAgo - m) % every) continue;
    const receivedAtMs = NOW - m * MIN;
    for (let k = 0; k < perMinute; k++) {
      const point = points[k % points.length];
      recordObservation(sensor, { id: `${sensor}-${k}`, lat: point.lat, lon: point.lon, observedAtMs: receivedAtMs - (lagMs ?? 0), receivedAtMs, lagMs }, freshLag);
    }
  }
}

function coverage(sensor: SensorType, options: { cells?: Set<number> | null; source?: SourceAvailability; nowMs?: number } = {}): SensorCoverage {
  return computeCoverage({
    store: sensorStore(sensor),
    params: sensor === "adsb" ? ADSB_PARAMS : AIS_PARAMS,
    cells: options.cells ?? null,
    nowMs: options.nowMs ?? NOW,
    source: options.source ?? "ok",
  });
}

const render = (sensor: SensorType, value: SensorCoverage | null, locale: "fr" | "en" = "fr") =>
  renderToStaticMarkup(createElement(CoverageLine, { sensor, coverage: value, locale }));

beforeEach(() => clearCoverageObservations());

describe("couverture des capteurs — score", () => {
  it("1. beaucoup de positions récentes et continues → élevée (excellente seulement avec un historique)", () => {
    feed({ sensor: "adsb", fromMinutesAgo: 20, perMinute: 200 });
    const result = coverage("adsb");
    expect(result.state).toBe("measured");
    expect(["high", "excellent"]).toContain(result.level);
    // Sans référence habituelle, la dispersion n'est pas évaluable : jamais « excellente ».
    expect(result.level).toBe("high");
    expect(result.reasonCodes).toContain("fresh_positions");
    expect(result.reasonCodes).toContain("continuity_ok");
    expect(result.reasonCodes).toContain("no_history");
  });

  it("1 bis. avec quatre heures d'historique homogène, la même situation atteint « excellente »", () => {
    feed({ sensor: "adsb", fromMinutesAgo: 4 * 60 + 20, perMinute: 200 });
    const result = coverage("adsb");
    expect(result.factors.dispersion).toBe(1);
    expect(result.level).toBe("excellent");
  });

  it("2. peu de positions et très anciennes → faible ou très faible", () => {
    feed({ sensor: "adsb", fromMinutesAgo: 14, toMinutesAgo: 12, perMinute: 4, lagMs: 50 * MIN, every: 1 });
    const result = coverage("adsb");
    expect(result.state).toBe("measured");
    expect(["low", "very_low"]).toContain(result.level);
    expect(result.score!).toBeLessThanOrEqual(CAPS.stale);
    expect(result.reasonCodes).toContain("stale_positions");
  });

  it("3. aucune donnée → inconnue", () => {
    const result = coverage("ais");
    expect(result.level).toBe("unknown");
    expect(result.state).toBe("insufficient_data");
    expect(result.score).toBeNull();
    expect(result.sampleSize).toBe(0);
    expect(result.lastObservationAt).toBeNull();
  });

  it("4. beaucoup de positions mais transmises avec retard → jamais élevée", () => {
    feed({ sensor: "adsb", fromMinutesAgo: 20, perMinute: 200, lagMs: 4 * MIN });
    const result = coverage("adsb");
    expect(result.score!).toBeLessThanOrEqual(CAPS.notFresh);
    expect(["high", "excellent"]).not.toContain(result.level);
    expect(result.reasonCodes).toContain("delayed_positions");
  });

  it("4 bis. beaucoup de positions mais réception arrêtée depuis 20 min → au mieux faible", () => {
    feed({ sensor: "ais", fromMinutesAgo: 40, toMinutesAgo: 20, perMinute: 2_000 });
    const result = coverage("ais");
    expect(result.sampleSize).toBeGreaterThan(1_000);
    expect(result.score!).toBeLessThanOrEqual(CAPS.stale);
    expect(["low", "very_low"]).toContain(result.level);
  });

  it("7. source en erreur → couverture indisponible, sans score", () => {
    feed({ sensor: "adsb", fromMinutesAgo: 20, perMinute: 200 });
    const result = coverage("adsb", { source: "unavailable" });
    expect(result).toMatchObject({ level: "unknown", state: "source_unavailable", score: null, reasonCodes: ["source_unavailable"] });
    expect(coverageLevelLabel(result, "fr")).toBe("Indisponible");
    expect(coverageLevelLabel(result, "en")).toBe("Unavailable");
    // Registre de santé → disponibilité.
    expect(sourceAvailability("unavailable")).toBe("unavailable");
    expect(sourceAvailability("unconfigured")).toBe("unavailable");
    expect(sourceAvailability("stale")).toBe("failing");
    expect(sourceAvailability("pending")).toBe("pending");
    expect(sourceAvailability(null)).toBe("pending");
  });

  it("7 bis. source pas encore interrogée → inconnue ; source en échec → raison affichée", () => {
    expect(coverage("ais", { source: "pending" })).toMatchObject({ level: "unknown", state: "insufficient_data", reasonCodes: ["source_pending"] });
    feed({ sensor: "ais", fromMinutesAgo: 30, perMinute: 500 });
    expect(coverage("ais", { source: "failing" }).reasonCodes).toContain("source_failing");
  });

  it("8. échantillon trop petit → inconnue", () => {
    feed({ sensor: "adsb", fromMinutesAgo: 10, perMinute: 1, every: 2 });
    const result = coverage("adsb");
    expect(result.sampleSize).toBeLessThan(ADSB_PARAMS.minSamples);
    expect(result).toMatchObject({ level: "unknown", state: "insufficient_data", score: null });
    expect(result.reasonCodes).toContain("insufficient_sample");
  });

  it("8 bis. historique trop court (redémarrage) → inconnue même avec beaucoup de positions", () => {
    feed({ sensor: "ais", fromMinutesAgo: 3, perMinute: 3_000 });
    expect(coverage("ais")).toMatchObject({ level: "unknown", reasonCodes: ["short_history"] });
  });

  it("9. score reproductible : mêmes entrées → même résultat, valeur attendue", () => {
    feed({ sensor: "adsb", fromMinutesAgo: 20, perMinute: 200 });
    const first = coverage("adsb");
    const second = coverage("adsb");
    expect(second).toEqual(first);
    clearCoverageObservations();
    feed({ sensor: "adsb", fromMinutesAgo: 20, perMinute: 200 });
    expect(coverage("adsb")).toEqual(first);
    // F = 1, V = 1, C = 1, D non évaluable (0,5) → 100 × (0,35 + 0,2 + 0,25 + 0,2 × 0,5) = 90, plafonné à 89.
    expect(first.score).toBe(CAPS.notExcellent);
    expect(first.factors).toEqual({ freshness: 1, volume: 1, continuity: 1, dispersion: null });
  });

  it("10. ADS-B et AIS ont des paramètres distincts : un retard de 90 s est frais en AIS, pas en ADS-B", () => {
    expect(ADSB_PARAMS.freshLagMs).not.toBe(AIS_PARAMS.freshLagMs);
    expect(ADSB_PARAMS.windowMs).not.toBe(AIS_PARAMS.windowMs);
    expect(ADSB_PARAMS.minSamples).not.toBe(AIS_PARAMS.minSamples);
    expect(ADSB_PARAMS.volumeRef).not.toEqual(AIS_PARAMS.volumeRef);
    for (const params of [ADSB_PARAMS, AIS_PARAMS]) {
      const { freshness, volume, continuity, dispersion } = params.weights;
      expect(freshness + volume + continuity + dispersion).toBeCloseTo(1, 10);
    }
    feed({ sensor: "adsb", fromMinutesAgo: 35, perMinute: 200, lagMs: 90_000 });
    feed({ sensor: "ais", fromMinutesAgo: 35, perMinute: 200, lagMs: 90_000 });
    expect(coverage("ais").factors.freshness).toBe(1);
    expect(coverage("adsb").factors.freshness).toBe(0);
  });

  it("interruptions de réception → continuité pénalisée", () => {
    feed({ sensor: "ais", fromMinutesAgo: 30, perMinute: 2_000, every: 8 });
    const result = coverage("ais");
    expect(result.factors.continuity!).toBeLessThan(0.8);
    expect(result.reasonCodes).toContain("continuity_gaps");
    expect(["high", "excellent"]).not.toContain(result.level);
  });

  it("zone d'ordinaire observée devenue muette → très faible (trou établi, pas une inconnue)", () => {
    const channel = { lat: 50.9, lon: 1.5 };
    // Quatre heures de trafic dans la Manche et ailleurs, puis plus rien dans la Manche.
    for (let m = 4 * 60 + 30; m >= 0; m--) {
      const receivedAtMs = NOW - m * MIN;
      const zone = m > 30 ? 40 : 0;
      for (let k = 0; k < zone; k++) recordObservation("ais", { id: `c${k}`, ...channel, observedAtMs: receivedAtMs, receivedAtMs, lagMs: 1_000 }, AIS_PARAMS.freshLagMs);
      for (let k = 0; k < 400; k++) recordObservation("ais", { id: `o${k}`, lat: 1.2, lon: 103.8, observedAtMs: receivedAtMs, receivedAtMs, lagMs: 1_000 }, AIS_PARAMS.freshLagMs);
    }
    const result = coverage("ais", { cells: cellsAround(channel.lat, channel.lon) });
    expect(result).toMatchObject({ level: "very_low", state: "measured" });
    expect(result.reasonCodes).toContain("silent_usual_zone");
  });

  it("une zone sans aucun historique (pays enclavé pour l'AIS) reste inconnue", () => {
    feed({ sensor: "ais", fromMinutesAgo: 30, perMinute: 500, points: [{ lat: 1.2, lon: 103.8 }] });
    const switzerland = cellsInBox(5.9, 45.8, 10.5, 47.8);
    expect(coverage("ais", { cells: switzerland })).toMatchObject({ level: "unknown", state: "insufficient_data" });
  });

  it("zone sans historique : jamais mieux que « moyenne », même avec des données parfaites", () => {
    feed({ sensor: "adsb", fromMinutesAgo: 20, perMinute: 200 });
    const zone = coverage("adsb", { cells: new Set(SPREAD.map((point) => cellOf(point.lat, point.lon))) });
    expect(zone.factors).toMatchObject({ freshness: 1, volume: 1, continuity: 1, dispersion: null });
    expect(zone.score).toBe(CAPS.zoneWithoutHistory);
    expect(zone.level).toBe("medium");
    // Le monde entier, lui, peut atteindre « élevée » sans historique.
    expect(coverage("adsb").level).toBe("high");
  });

  it("niveaux : seuils 90 / 70 / 45 / 20", () => {
    expect(LEVEL_THRESHOLDS).toEqual({ excellent: 90, high: 70, medium: 45, low: 20 });
    expect([100, 90, 89, 70, 69, 45, 44, 20, 19, 0].map(levelFromScore)).toEqual([
      "excellent", "excellent", "high", "high", "medium", "medium", "low", "low", "very_low", "very_low",
    ]);
  });
});

describe("couverture des capteurs — collecte", () => {
  it("ADS-B : toutes les positions de la réponse comptent, y compris celles trop vieilles pour le globe", () => {
    const now = NOW;
    recordAdsbCoverage({ now, ac: [
      { hex: "AE01", lat: 48, lon: 2, seen_pos: 2 },
      { hex: "ae02", lat: 49, lon: 3, seen_pos: 600 },
      { hex: "ae03", lat: 50, lon: 4 },
      { hex: "ae04", lat: 95, lon: 4, seen_pos: 1 },
    ] }, now);
    const bucket = sensorStore("adsb").minutes.get(Math.floor(now / MIN))!;
    const totals = [...bucket.cells.values()].reduce((acc, cell) => ({ positions: acc.positions + cell.positions, fresh: acc.fresh + cell.fresh }), { positions: 0, fresh: 0 });
    expect(totals).toEqual({ positions: 2, fresh: 1 });
  });

  it("AIS : `time_utc` est lu en UTC strict, sinon le délai reste inconnu", () => {
    expect(aisTimeUtc("2026-10-20 08:21:43.123456 +0000 UTC")).toBe(Date.parse("2026-10-20T08:21:43.123Z"));
    expect(aisTimeUtc("2026-10-20T08:21:43Z")).toBe(Date.parse("2026-10-20T08:21:43Z"));
    expect(aisTimeUtc("2026-10-20 08:21:43 +0200")).toBeNull();
    expect(aisTimeUtc("hier")).toBeNull();
    expect(aisTimeUtc(undefined)).toBeNull();
  });

  it("délai non publié : la fraîcheur repose sur la seule récence, et la raison le dit", () => {
    feed({ sensor: "ais", fromMinutesAgo: 30, perMinute: 500, lagMs: null });
    expect(coverage("ais").reasonCodes).toContain("latency_unknown");
  });

  it("zone d'un pays : cellules du territoire réel, pas de son rectangle englobant", async () => {
    const world = await loadWorldIndex();
    const france = countryCoverageCells(world, "FRA")!;
    expect(france.has(cellOf(48.8, 2.3))).toBe(true);
    expect(france.has(cellOf(4.9, -52.3))).toBe(true); // Guyane
    expect(france.has(cellOf(20, -30))).toBe(false); // milieu de l'Atlantique, dans le rectangle
    expect(countryCoverageCells(world, "ZZZ")).toBeNull();
  });

  it("grille : rectangle traversant l'antiméridien et voisinage d'un point", () => {
    const fiji = cellsInBox(177, -21, -178, -12);
    expect(fiji.size).toBeGreaterThan(0);
    expect(cellsAround(0, 179).size).toBe(9);
    expect(cellsAround(89, 0).size).toBe(6);
  });
});

describe("couverture des capteurs — interface", () => {
  const weak = (sensor: SensorType, level: SensorCoverage["level"], state: SensorCoverage["state"] = "measured"): SensorCoverage => ({
    sourceType: sensor, level, state, score: level === "unknown" ? null : 30, sampleSize: 12, lastObservationAt: null, freshnessMs: null,
    factors: { freshness: 0.2, volume: 0.3, continuity: 0.4, dispersion: null }, reasonCodes: ["volume_low", "stale_positions"], reason: [], caveat: "", windowMs: 60_000,
  });

  it("5. couverture faible → avertissement visible dans l'interface", () => {
    const html = render("ais", weak("ais", "low"));
    expect(html).toContain("Couverture AIS");
    expect(html).toContain("FAIBLE");
    expect(html).toContain("Peu de positions récentes");
    expect(html).toContain('class="coverage-caveat"');
    expect(html).toContain("Absence de navires non significative");
    expect(render("adsb", weak("adsb", "very_low"), "en")).toContain("Absence of aircraft is not meaningful");
  });

  it("6. absence de trafic + couverture faible → jamais « aucune activité »", () => {
    for (const level of ["low", "very_low", "unknown"] as const) {
      for (const sensor of ["adsb", "ais"] as const) {
        const html = render(sensor, weak(sensor, level)).toLowerCase();
        expect(html).not.toMatch(/aucune activité|pas d'activité|activité (faible|nulle)|no activity/);
        expect(html).toContain("non significative");
      }
    }
    // Aucun libellé de la couverture ne parle d'activité, sauf l'aide qui précise que ce n'en est pas une mesure.
    const labels = [...Object.values(LEVEL_LABELS), ...Object.values(REASON_LABELS)].flatMap((label) => [label.fr, label.en]);
    for (const label of labels) expect(label.toLowerCase()).not.toMatch(/activit/);
    expect(COVERAGE_HELP.fr).toContain("pas le niveau réel d'activité");
  });

  it("7 ter. source indisponible : libellé « Indisponible » et avertissement visible", () => {
    const html = render("adsb", weak("adsb", "unknown", "source_unavailable"));
    expect(html).toContain("INDISPONIBLE");
    expect(html).toContain("Absence d&#x27;avions non significative");
  });

  it("couverture élevée : pas d'avertissement d'absence, aide accessible au survol et au dépliage", () => {
    const html = render("adsb", { ...weak("adsb", "high"), reasonCodes: ["fresh_positions", "continuity_ok"] });
    expect(html).toContain("ÉLEVÉE");
    expect(html).toContain("Positions fraîches · Continuité correcte");
    expect(html).not.toContain("coverage-caveat");
    expect(html).toContain(COVERAGE_HELP.fr.replaceAll("'", "&#x27;"));
  });

  it("donnée absente (API en échec) → « inconnue » avec avertissement, jamais un niveau inventé", () => {
    const html = render("ais", null);
    expect(html).toContain("inconnue");
    expect(html).toContain("Absence de navires non significative");
  });
});
