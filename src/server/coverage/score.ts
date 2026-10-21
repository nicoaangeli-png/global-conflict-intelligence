import type { CoverageFactors, CoverageReason, SensorCoverage, SensorCoverageLevel, SensorCoverageState, SensorType } from "@/types/coverage";
import { REASON_LABELS, coverageCaveat } from "@/lib/coverage";
import { HOUR_MS, MINUTE_MS, maintain, type SensorStore } from "./observations";

/**
 * Score de couverture déterministe et explicable (0–100).
 *
 *   base = 100 × (wF·F + wV·V + wC·C + wD·D)
 *   score = base − pénalités, puis plafonds, borné à [0, 100]
 *
 * F fraîcheur, V volume, C continuité, D dispersion : chacun entre 0 et 1 (détail plus bas).
 * Les paramètres de chaque capteur sont regroupés dans `ADSB_PARAMS` / `AIS_PARAMS`.
 */

export interface CoverageParams {
  sensor: SensorType;
  /** Fenêtre d'analyse. */
  windowMs: number;
  /** Délai émission → réception jugé « frais ». */
  freshLagMs: number;
  /** Âge de la dernière observation encore pleinement récent. */
  recentOkMs: number;
  /** Au-delà, les données sont anciennes : jamais mieux que « faible ». */
  staleMs: number;
  /** Plus longue interruption de réception tolérée sans pénalité… */
  gapOkMs: number;
  /** …et à partir de laquelle la continuité vaut 0. */
  gapBadMs: number;
  /** Historique minimal avant toute conclusion. */
  minSpanMs: number;
  /** Positions minimales dans la fenêtre et la zone ; en dessous : « inconnue ». */
  minSamples: number;
  /** Émetteurs par minute considérés comme un volume plein, sans historique. */
  volumeRef: { global: number; zone: number };
  /** Heures de référence nécessaires pour comparer à l'habitude. */
  minBaselineHours: number;
  /** Minutes actives minimales pour qu'une heure serve de référence. */
  minActiveMinutesPerHour: number;
  /** Une cellule est « habituelle » si observée dans au moins cette part des heures de référence. */
  habitualShare: number;
  /** Émetteurs/minute habituels au-delà desquels un silence signale un trou de couverture. */
  silenceBaseline: number;
  weights: { freshness: number; volume: number; continuity: number; dispersion: number };
  penalties: { smallSample: number; holes: number };
}

/**
 * ADS-B : polling de `/v2/mil` toutes les 30 s quand l'interface est ouverte. Le délai
 * `seen_pos` est publié. Peu d'émetteurs (seuls les militaires) : fraîcheur et continuité
 * pèsent plus que le volume.
 */
export const ADSB_PARAMS: CoverageParams = {
  sensor: "adsb",
  windowMs: 15 * MINUTE_MS,
  freshLagMs: 60_000,
  recentOkMs: 3 * MINUTE_MS,
  staleMs: 15 * MINUTE_MS,
  gapOkMs: 3 * MINUTE_MS,
  gapBadMs: 15 * MINUTE_MS,
  minSpanMs: 5 * MINUTE_MS,
  minSamples: 10,
  // Calibré le 2026-10-20 : ≈ 250 aéronefs militaires publiés dans le monde, ≈ 9 par poll autour de la Suisse ou de l'Ukraine.
  volumeRef: { global: 150, zone: 30 },
  minBaselineHours: 3,
  minActiveMinutesPerHour: 5,
  habitualShare: 0.5,
  silenceBaseline: 8,
  weights: { freshness: 0.35, volume: 0.2, continuity: 0.25, dispersion: 0.2 },
  penalties: { smallSample: 10, holes: 10 },
};

/**
 * AIS : flux WebSocket continu (AISStream), tous navires confondus. Délai de transmission
 * tiré de `time_utc` quand il est publié ; positions plus espacées que l'ADS-B (navires lents).
 */
export const AIS_PARAMS: CoverageParams = {
  sensor: "ais",
  windowMs: 30 * MINUTE_MS,
  freshLagMs: 2 * MINUTE_MS,
  recentOkMs: 2 * MINUTE_MS,
  staleMs: 15 * MINUTE_MS,
  gapOkMs: 2 * MINUTE_MS,
  gapBadMs: 10 * MINUTE_MS,
  minSpanMs: 10 * MINUTE_MS,
  minSamples: 30,
  // Calibré le 2026-10-20 : ≈ 4 500 positions/min dans le monde, ≈ 2 000/min autour de la Manche, ≈ 27/min autour de Singapour.
  volumeRef: { global: 3000, zone: 300 },
  minBaselineHours: 3,
  minActiveMinutesPerHour: 20,
  habitualShare: 0.5,
  silenceBaseline: 10,
  weights: { freshness: 0.3, volume: 0.25, continuity: 0.25, dispersion: 0.2 },
  penalties: { smallSample: 10, holes: 10 },
};

/** Seuils des niveaux (score ≥ seuil). En dessous de `low` : très faible. */
export const LEVEL_THRESHOLDS = { excellent: 90, high: 70, medium: 45, low: 20 } as const;

/** Plafonds appliqués quelles que soient les composantes. */
export const CAPS = {
  /** Dernière observation plus vieille que `staleMs` : au mieux « faible ». */
  stale: LEVEL_THRESHOLDS.medium - 1,
  /** Données pas assez fraîches (part fraîche < 50 % ou dernière observation > `recentOkMs`) : au mieux « moyenne ». */
  notFresh: LEVEL_THRESHOLDS.high - 1,
  /**
   * Zone (pays, voisinage) sans historique de 3 h : au mieux « moyenne ». Les échantillons locaux
   * sont petits (l'ADS-B ne voit que les militaires) : sans comparaison possible, pas de niveau élevé.
   */
  zoneWithoutHistory: LEVEL_THRESHOLDS.high - 1,
  /** « Excellente » exige toutes les composantes ≥ 0,8 et connues. */
  notExcellent: LEVEL_THRESHOLDS.excellent - 1,
} as const;

export type SourceAvailability = "ok" | "failing" | "unavailable" | "pending";

export interface CoverageInput {
  store: SensorStore;
  params: CoverageParams;
  /** null = monde entier. */
  cells: Set<number> | null;
  nowMs: number;
  source: SourceAvailability;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** 1 si `value` ≤ `ok`, 0 si ≥ `bad`, linéaire entre les deux. */
const ramp = (value: number, ok: number, bad: number) => clamp01(1 - (value - ok) / (bad - ok));
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export function levelFromScore(score: number): SensorCoverageLevel {
  if (score >= LEVEL_THRESHOLDS.excellent) return "excellent";
  if (score >= LEVEL_THRESHOLDS.high) return "high";
  if (score >= LEVEL_THRESHOLDS.medium) return "medium";
  if (score >= LEVEL_THRESHOLDS.low) return "low";
  return "very_low";
}

function result(
  params: CoverageParams,
  state: SensorCoverageState,
  level: SensorCoverageLevel,
  score: number | null,
  sampleSize: number,
  newestMs: number | null,
  nowMs: number,
  factors: CoverageFactors,
  reasonCodes: CoverageReason[],
): SensorCoverage {
  const unique = [...new Set(reasonCodes)];
  return {
    sourceType: params.sensor,
    level,
    state,
    score: score === null ? null : Math.round(score),
    sampleSize,
    lastObservationAt: newestMs === null ? null : new Date(newestMs).toISOString(),
    freshnessMs: newestMs === null ? null : Math.max(0, nowMs - newestMs),
    factors,
    reasonCodes: unique,
    reason: unique.map((code) => REASON_LABELS[code].fr),
    caveat: coverageCaveat(params.sensor, level, "fr"),
    windowMs: params.windowMs,
  };
}

const NO_FACTORS: CoverageFactors = { freshness: null, volume: null, continuity: null, dispersion: null };

/** Calcule la couverture d'un capteur sur une zone. Fonction pure vis-à-vis de ses entrées. */
export function computeCoverage({ store, params, cells, nowMs, source }: CoverageInput): SensorCoverage {
  if (source === "unavailable") return result(params, "source_unavailable", "unknown", null, 0, null, nowMs, NO_FACTORS, ["source_unavailable"]);
  if (source === "pending") return result(params, "insufficient_data", "unknown", null, 0, null, nowMs, NO_FACTORS, ["source_pending"]);
  maintain(store, nowMs);
  const inScope = (cell: number) => cells === null || cells.has(cell);
  const windowStart = nowMs - params.windowMs;
  const currentMinute = Math.floor(nowMs / MINUTE_MS);

  // --- Fenêtre d'analyse : minutes où le capteur a reçu quelque chose, et part de la zone.
  let sampleSize = 0;
  let fresh = 0;
  let lagKnown = 0;
  let newestMs: number | null = null;
  const activeMinutes: number[] = [];
  const scopeEmitters: number[] = [];
  let scopeMinutes = 0;
  const activeCells = new Set<number>();
  for (const bucket of store.minutes.values()) {
    if ((bucket.minute + 1) * MINUTE_MS <= windowStart || bucket.minute > currentMinute) continue;
    activeMinutes.push(bucket.minute);
    let emitters = 0;
    let any = false;
    for (const [cell, data] of bucket.cells) {
      if (!inScope(cell)) continue;
      any = true;
      sampleSize += data.positions;
      fresh += data.fresh;
      lagKnown += data.lagKnown;
      emitters += data.ids ? data.ids.size : data.emitters;
      activeCells.add(cell);
      if (newestMs === null || data.newestObservedMs > newestMs) newestMs = data.newestObservedMs;
    }
    scopeEmitters.push(emitters);
    if (any) scopeMinutes++;
  }
  if (newestMs !== null && newestMs > nowMs) newestMs = nowMs;

  // --- Référence habituelle (heures complètes précédentes, 24 h au plus).
  const currentHour = Math.floor(nowMs / HOUR_MS);
  const baselineHours = [...store.hours.values()].filter((hour) => hour.hour < currentHour && hour.activeMinutes >= params.minActiveMinutesPerHour);
  const hasBaseline = baselineHours.length >= params.minBaselineHours;
  let baselineVolume: number | null = null;
  let habitual: Set<number> | null = null;
  if (hasBaseline) {
    const perHour: number[] = [];
    const seenHours = new Map<number, number>();
    for (const hour of baselineHours) {
      let total = 0;
      for (const [cell, sum] of hour.emitterMinutes) {
        if (!inScope(cell) || sum <= 0) continue;
        total += sum;
        seenHours.set(cell, (seenHours.get(cell) ?? 0) + 1);
      }
      perHour.push(total / hour.activeMinutes);
    }
    baselineVolume = median(perHour);
    habitual = new Set([...seenHours].filter(([, count]) => count / baselineHours.length >= params.habitualShare).map(([cell]) => cell));
  }

  const reasons: CoverageReason[] = [];
  if (source === "failing") reasons.push("source_failing");

  // --- Cas inconnus : historique trop court, échantillon trop faible.
  const span = store.firstObservationMs === null ? 0 : nowMs - Math.max(windowStart, store.firstObservationMs);
  if (store.firstObservationMs === null || span < params.minSpanMs) {
    return result(params, "insufficient_data", "unknown", null, sampleSize, newestMs, nowMs, NO_FACTORS, [...reasons, "short_history"]);
  }
  if (sampleSize < params.minSamples) {
    // Zone d'ordinaire bien observée devenue muette alors que le capteur reçoit ailleurs :
    // c'est un trou de couverture établi, pas une inconnue.
    const silentUsualZone = baselineVolume !== null && baselineVolume >= params.silenceBaseline && activeMinutes.length > 0;
    if (silentUsualZone) {
      return result(params, "measured", "very_low", 0, sampleSize, newestMs, nowMs, { ...NO_FACTORS, volume: 0 }, [...reasons, "silent_usual_zone"]);
    }
    return result(params, "insufficient_data", "unknown", null, sampleSize, newestMs, nowMs, NO_FACTORS, [...reasons, "insufficient_sample"]);
  }

  // --- F : fraîcheur = part des positions transmises sans retard × récence de la dernière.
  const newestAge = newestMs === null ? Number.POSITIVE_INFINITY : nowMs - newestMs;
  const recency = ramp(newestAge, params.recentOkMs, params.staleMs);
  const freshShare = lagKnown > 0 ? fresh / lagKnown : null;
  const freshness = (freshShare ?? 1) * recency;
  if (newestAge > params.staleMs) reasons.push("stale_positions");
  else if (freshShare !== null && freshShare < 0.5) reasons.push("delayed_positions");
  else if (newestAge > params.recentOkMs) reasons.push("stale_positions");
  else reasons.push("fresh_positions");
  if (freshShare === null) reasons.push("latency_unknown");

  // --- C : continuité = interruption la plus longue (réception globale) × part des minutes où la zone répond.
  const sorted = [...activeMinutes].sort((a, b) => a - b).map((minute) => minute * MINUTE_MS);
  const start = Math.max(windowStart, store.firstObservationMs);
  let maxGap = sorted.length ? Math.max(0, sorted[0] - start) : params.windowMs;
  for (let i = 1; i < sorted.length; i++) maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1] - MINUTE_MS);
  if (sorted.length) maxGap = Math.max(maxGap, nowMs - (sorted[sorted.length - 1] + MINUTE_MS));
  const globalContinuity = ramp(maxGap, params.gapOkMs, params.gapBadMs);
  const scopeShare = activeMinutes.length ? scopeMinutes / activeMinutes.length : 0;
  const continuity = globalContinuity * scopeShare;
  if (globalContinuity < 0.8) reasons.push("continuity_gaps");
  else if (scopeShare < 0.8) reasons.push("regional_intermittent");
  else reasons.push("continuity_ok");

  // --- V : volume = émetteurs par minute (médiane) rapportés à l'habitude, sinon à une référence.
  const volumeNow = median(scopeEmitters);
  let volume: number;
  if (baselineVolume !== null && baselineVolume > 0) {
    volume = clamp01(volumeNow / baselineVolume);
    reasons.push(volume >= 0.8 ? "volume_usual" : "volume_below_usual");
  } else {
    const ref = cells === null ? params.volumeRef.global : params.volumeRef.zone;
    volume = clamp01(Math.log1p(volumeNow) / Math.log1p(ref));
    if (volume >= 0.8) reasons.push("volume_high");
    else if (volume < 0.5) reasons.push("volume_low");
  }

  // --- D : dispersion = part des cellules habituellement observées qui répondent encore.
  let dispersion: number | null = null;
  let holes = 0;
  if (habitual && habitual.size > 0) {
    let answering = 0;
    for (const cell of habitual) if (activeCells.has(cell)) answering++;
    holes = habitual.size - answering;
    dispersion = answering / habitual.size;
    if (dispersion >= 0.8) reasons.push("dispersion_ok");
    else reasons.push("coverage_holes");
  } else {
    reasons.push("no_history");
  }

  const { weights, penalties } = params;
  // Dispersion non évaluable : contribution neutre (0,5), jamais un bonus.
  const base = 100 * (weights.freshness * freshness + weights.volume * volume + weights.continuity * continuity + weights.dispersion * (dispersion ?? 0.5));
  let score = base;
  if (sampleSize < 3 * params.minSamples) {
    score -= penalties.smallSample;
    reasons.push("small_sample");
  }
  if (habitual && holes >= 3 && holes / habitual.size >= 0.3) score -= penalties.holes;

  // --- Plafonds : la densité seule ne suffit jamais.
  if (newestAge > params.staleMs) score = Math.min(score, CAPS.stale);
  if ((freshShare !== null && freshShare < 0.5) || newestAge > params.recentOkMs) score = Math.min(score, CAPS.notFresh);
  if (cells !== null && dispersion === null) score = Math.min(score, CAPS.zoneWithoutHistory);
  const allStrong = freshness >= 0.8 && volume >= 0.8 && continuity >= 0.8 && dispersion !== null && dispersion >= 0.8;
  if (!allStrong) score = Math.min(score, CAPS.notExcellent);
  score = Math.min(100, Math.max(0, score));

  const factors: CoverageFactors = {
    freshness: Math.round(freshness * 100) / 100,
    volume: Math.round(volume * 100) / 100,
    continuity: Math.round(continuity * 100) / 100,
    dispersion: dispersion === null ? null : Math.round(dispersion * 100) / 100,
  };
  const level = levelFromScore(score);
  // Raisons défavorables d'abord quand le niveau est médiocre, favorables d'abord sinon.
  const negative = new Set<CoverageReason>(["stale_positions", "delayed_positions", "continuity_gaps", "regional_intermittent", "volume_low", "volume_below_usual", "coverage_holes", "small_sample", "source_failing", "latency_unknown", "no_history"]);
  const ordered = [...reasons].sort((a, b) => {
    const rank = (code: CoverageReason) => (negative.has(code) ? 0 : 1);
    return level === "excellent" || level === "high" ? rank(b) - rank(a) : rank(a) - rank(b);
  });
  return result(params, "measured", level, score, sampleSize, newestMs, nowMs, factors, ordered);
}
