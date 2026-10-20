/**
 * Qualité probable de l'observation ADS-B (avions) et AIS (navires).
 *
 * Ce n'est JAMAIS une mesure de l'activité : une couverture faible signifie que
 * l'absence de points sur le globe n'est pas significative, rien de plus.
 */

export const SENSOR_COVERAGE_LEVELS = ["excellent", "high", "medium", "low", "very_low", "unknown"] as const;
export type SensorCoverageLevel = (typeof SENSOR_COVERAGE_LEVELS)[number];

export type SensorType = "adsb" | "ais";

/**
 * - measured           : score calculé sur un échantillon suffisant.
 * - insufficient_data  : échantillon ou historique trop court pour conclure (niveau `unknown`).
 * - source_unavailable : source en panne ou non configurée (niveau `unknown`, affiché « indisponible »).
 */
export type SensorCoverageState = "measured" | "insufficient_data" | "source_unavailable";

/** Raisons lisibles, traduites côté interface (`src/lib/coverage.ts`). */
export const COVERAGE_REASONS = [
  "fresh_positions",
  "stale_positions",
  "delayed_positions",
  "latency_unknown",
  "continuity_ok",
  "continuity_gaps",
  "regional_intermittent",
  "volume_usual",
  "volume_high",
  "volume_low",
  "volume_below_usual",
  "dispersion_ok",
  "coverage_holes",
  "no_history",
  "small_sample",
  "insufficient_sample",
  "short_history",
  "silent_usual_zone",
  "source_unavailable",
  "source_pending",
  "source_failing",
] as const;
export type CoverageReason = (typeof COVERAGE_REASONS)[number];

/** Composantes du score, chacune entre 0 et 1 (null = non évaluable). */
export interface CoverageFactors {
  freshness: number | null;
  volume: number | null;
  continuity: number | null;
  dispersion: number | null;
}

export interface CoverageScope {
  kind: "global" | "country" | "point";
  /** Code ISO alpha-3 ou « lat,lon » arrondis ; null pour le monde entier. */
  id: string | null;
  /** Nombre de cellules de grille (5° × 5°) prises en compte ; null pour le monde entier. */
  cells: number | null;
}

export interface SensorCoverage {
  sourceType: SensorType;
  level: SensorCoverageLevel;
  state: SensorCoverageState;
  /** Score interne 0–100, explicable ; null si non mesuré. L'interface privilégie le libellé. */
  score: number | null;
  /** Positions reçues dans la fenêtre d'analyse et dans la zone. */
  sampleSize: number;
  lastObservationAt: string | null;
  /** Âge de la dernière observation au moment du calcul (ms). */
  freshnessMs: number | null;
  factors: CoverageFactors;
  reasonCodes: CoverageReason[];
  /** Raisons en français (les mêmes que `reasonCodes`), pour AURA et l'API. */
  reason: string[];
  /** Avertissement adapté au niveau, en français. */
  caveat: string;
  windowMs: number;
}

export interface CoverageResponse {
  generatedAt: string;
  scope: CoverageScope;
  adsb: SensorCoverage;
  ais: SensorCoverage;
  /** Rappel méthodologique constant. */
  note: string;
}
