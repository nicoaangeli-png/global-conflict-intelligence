import type { CoverageReason, SensorCoverage, SensorCoverageLevel, SensorType } from "@/types/coverage";
import type { Locale } from "@/lib/i18n";

/**
 * Libellés FR/EN de la couverture des capteurs, partagés par le serveur (texte français
 * de l'API, AURA) et l'interface. Vocabulaire volontairement prudent : on décrit la
 * qualité de l'observation, jamais le niveau d'activité.
 */

type Bilingual = { fr: string; en: string };

export const SENSOR_LABELS: Record<SensorType, Bilingual> = {
  adsb: { fr: "ADS-B", en: "ADS-B" },
  ais: { fr: "AIS", en: "AIS" },
};

export const LEVEL_LABELS: Record<SensorCoverageLevel, Bilingual> = {
  excellent: { fr: "Excellente", en: "Excellent" },
  high: { fr: "Élevée", en: "High" },
  medium: { fr: "Moyenne", en: "Medium" },
  low: { fr: "Faible", en: "Low" },
  very_low: { fr: "Très faible", en: "Very low" },
  unknown: { fr: "Inconnue", en: "Unknown" },
};

export const UNAVAILABLE_LABEL: Bilingual = { fr: "Indisponible", en: "Unavailable" };

export const REASON_LABELS: Record<CoverageReason, Bilingual> = {
  fresh_positions: { fr: "Positions fraîches", en: "Fresh positions" },
  stale_positions: { fr: "Positions anciennes", en: "Stale positions" },
  delayed_positions: { fr: "Positions transmises avec retard", en: "Positions reported late" },
  latency_unknown: { fr: "Délai de transmission non publié", en: "Reporting delay not published" },
  continuity_ok: { fr: "Continuité correcte", en: "Steady reception" },
  continuity_gaps: { fr: "Interruptions de réception", en: "Reception gaps" },
  regional_intermittent: { fr: "Réception intermittente dans la zone", en: "Intermittent reception in the area" },
  volume_usual: { fr: "Volume conforme à l'habitude", en: "Usual volume" },
  volume_high: { fr: "Nombreuses positions récentes", en: "Many recent positions" },
  volume_low: { fr: "Peu de positions récentes", en: "Few recent positions" },
  volume_below_usual: { fr: "Volume inférieur à l'habitude", en: "Volume below usual" },
  dispersion_ok: { fr: "Bonne répartition géographique", en: "Good geographic spread" },
  coverage_holes: { fr: "Zones habituellement observées devenues silencieuses", en: "Usually observed areas gone silent" },
  no_history: { fr: "Historique trop court pour comparer à l'habitude", en: "History too short to compare with usual levels" },
  small_sample: { fr: "Échantillon limité", en: "Limited sample" },
  insufficient_sample: { fr: "Échantillon insuffisant pour conclure", en: "Sample too small to conclude" },
  short_history: { fr: "Observation commencée depuis trop peu de temps", en: "Observation started too recently" },
  silent_usual_zone: { fr: "Zone habituellement observée, silencieuse", en: "Usually observed area, now silent" },
  source_unavailable: { fr: "Source indisponible", en: "Source unavailable" },
  source_pending: { fr: "Source pas encore interrogée", en: "Source not queried yet" },
  source_failing: { fr: "Source en échec : dernières données servies", en: "Source failing: last data served" },
};

/** Aide constante (infobulle / volet dépliable). */
export const COVERAGE_HELP: Bilingual = {
  fr: "La couverture indique la qualité de l'observation disponible, pas le niveau réel d'activité.",
  en: "Coverage describes the quality of the available observation, not the actual level of activity.",
};

const ABSENCE: Record<SensorType, Bilingual> = {
  adsb: { fr: "Absence d'avions non significative", en: "Absence of aircraft is not meaningful" },
  ais: { fr: "Absence de navires non significative", en: "Absence of vessels is not meaningful" },
};

const COMPLETE: Record<SensorType, Bilingual> = {
  adsb: { fr: "observation aérienne relativement complète", en: "fairly complete air picture" },
  ais: { fr: "observation maritime relativement complète", en: "fairly complete maritime picture" },
};

const PARTIAL: Record<SensorType, Bilingual> = {
  adsb: { fr: "observation aérienne partielle", en: "partial air picture" },
  ais: { fr: "observation maritime partielle", en: "partial maritime picture" },
};

/** Méthode propre à chaque capteur, rappelée dans le volet d'aide. */
export const SENSOR_METHOD: Record<SensorType, Bilingual> = {
  adsb: {
    fr: "Estimée à partir des seuls aéronefs militaires publiés par adsb.lol / adsb.fi : le nombre de récepteurs n'est pas exposé, la couverture réelle n'est donc pas mesurée directement.",
    en: "Estimated from the military aircraft published by adsb.lol / adsb.fi only: receiver counts are not exposed, so actual coverage is not measured directly.",
  },
  ais: {
    fr: "Estimée à partir de tous les navires reçus par AISStream (pas seulement militaires) : la couverture côtière terrestre domine, la haute mer est souvent peu couverte.",
    en: "Estimated from every vessel received by AISStream (not only military): terrestrial coastal coverage dominates, open sea is often poorly covered.",
  },
};

export function isWeakCoverage(coverage: Pick<SensorCoverage, "level">): boolean {
  return coverage.level === "low" || coverage.level === "very_low" || coverage.level === "unknown";
}

export function coverageLevelLabel(coverage: Pick<SensorCoverage, "level" | "state">, locale: Locale): string {
  return coverage.state === "source_unavailable" ? UNAVAILABLE_LABEL[locale] : LEVEL_LABELS[coverage.level][locale];
}

export function coverageReasonLabels(coverage: Pick<SensorCoverage, "reasonCodes">, locale: Locale): string[] {
  return coverage.reasonCodes.map((code) => REASON_LABELS[code]?.[locale]).filter(Boolean);
}

/**
 * Avertissement adapté au niveau : élevé → « relativement complète » ; faible, très faible,
 * inconnu ou indisponible → l'absence de points n'est pas significative.
 */
export function coverageCaveat(sensor: SensorType, level: SensorCoverageLevel, locale: Locale): string {
  if (level === "excellent" || level === "high") return COMPLETE[sensor][locale];
  if (level === "medium") return PARTIAL[sensor][locale];
  return ABSENCE[sensor][locale];
}

export function absenceNotMeaningful(sensor: SensorType, locale: Locale): string {
  return ABSENCE[sensor][locale];
}
