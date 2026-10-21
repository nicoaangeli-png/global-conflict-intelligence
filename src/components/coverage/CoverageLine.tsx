"use client";

import type { SensorCoverage, SensorType } from "@/types/coverage";
import { tr, type Locale } from "@/lib/i18n";
import {
  COVERAGE_HELP,
  SENSOR_LABELS,
  SENSOR_METHOD,
  absenceNotMeaningful,
  coverageCaveat,
  coverageLevelLabel,
  coverageReasonLabels,
  isWeakCoverage,
} from "@/lib/coverage";

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/**
 * Ligne discrète « Couverture ADS-B : ÉLEVÉE · Positions fraîches · continuité correcte ».
 * Toute la ligne déplie l'aide (cible tactile large) ; l'avertissement d'absence non
 * significative reste visible dès que la couverture est faible, inconnue ou indisponible.
 */
export function CoverageLine({
  sensor,
  coverage,
  locale,
  loading = false,
  zone = false,
}: {
  sensor: SensorType;
  coverage: SensorCoverage | null;
  locale: Locale;
  loading?: boolean;
  /** Couverture de la zone (pays, voisinage) plutôt que mondiale. */
  zone?: boolean;
}) {
  const sensorName = SENSOR_LABELS[sensor][locale];
  const name = `${tr(locale, `Couverture ${sensorName}`, `${sensorName} coverage`)}${zone ? tr(locale, " (zone)", " (area)") : ""}`;
  if (!coverage) {
    return (
      <div className="coverage" data-level="unknown">
        <p className="coverage-summary">
          <span className="coverage-dot" aria-hidden />
          <span className="coverage-label">
            {name} : <strong className="coverage-level">{loading ? tr(locale, "calcul…", "computing…") : tr(locale, "inconnue", "unknown")}</strong>
          </span>
        </p>
        {!loading ? <p className="coverage-caveat">{absenceNotMeaningful(sensor, locale)}</p> : null}
      </div>
    );
  }
  const weak = isWeakCoverage(coverage);
  const reasons = coverageReasonLabels(coverage, locale);
  const short = reasons.slice(0, 2).join(" · ");
  const partial = coverage.level === "medium" ? capitalize(coverageCaveat(sensor, "medium", locale)) : null;
  const visibleCaveat = weak ? absenceNotMeaningful(sensor, locale) : partial;
  return (
    <div className="coverage" data-level={coverage.level} data-state={coverage.state}>
      <details className="coverage-details">
        <summary className="coverage-summary" title={COVERAGE_HELP[locale]}>
          <span className="coverage-dot" aria-hidden />
          <span className="coverage-label">
            {name} : <strong className="coverage-level">{coverageLevelLabel(coverage, locale).toLocaleUpperCase(locale === "fr" ? "fr-FR" : "en-US")}</strong>
          </span>
          {short ? <span className="coverage-reasons">{short}</span> : null}
        </summary>
        <div className="coverage-body">
          <p>{COVERAGE_HELP[locale]}</p>
          {coverage.level === "excellent" || coverage.level === "high" ? <p>{capitalize(coverageCaveat(sensor, coverage.level, locale))}.</p> : null}
          {reasons.length > 2 ? <p>{reasons.join(" · ")}</p> : null}
          <p className="meta">{SENSOR_METHOD[sensor][locale]}</p>
        </div>
      </details>
      {visibleCaveat ? <p className="coverage-caveat">{visibleCaveat}</p> : null}
    </div>
  );
}
