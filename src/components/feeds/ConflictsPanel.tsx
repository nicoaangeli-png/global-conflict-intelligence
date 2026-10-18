"use client";

import { useMemo } from "react";
import { TIME_RANGES, type SourceAvailability, type TimeRangeKey } from "@/types/conflict";
import { absoluteDateTime, int, relativeTime, shortDate } from "@/lib/format";
import { tr, type Locale } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import { activeNatures, clusterBreakdown, clusterPrecision, clusterSummary, natureOfSource, precisionLabel, toggleNature, type ConflictNature } from "./conflictModel";

/**
 * Onglet « Conflits » : données de conflit déjà ingérées (UCDP, GDELT, FIRMS…),
 * trois compteurs séparés et jamais additionnés, puis les zones signalées.
 */

const SOURCE_NAMES: Record<string, string> = {
  gdelt: "GDELT 2.0",
  ucdp: "UCDP GED",
  acled: "ACLED",
  firms: "NASA FIRMS",
  "import:csv": "Import CSV",
};

function Counter({
  title,
  value,
  hint,
  tone,
}: {
  title: string;
  value: string;
  hint: string;
  tone: ConflictNature;
}) {
  return (
    <div className="counter" data-tone={tone}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="counter-title">{title}</span>
        <span className="counter-value">{value}</span>
      </div>
      <p className="counter-hint">{hint}</p>
    </div>
  );
}

export function ConflictsPanel({ locale, now }: { locale: Locale; now: number }) {
  const stats = useIntelStore((s) => s.stats);
  const clusters = useIntelStore((s) => s.clusters);
  const filters = useIntelStore((s) => s.filters);
  const loading = useIntelStore((s) => s.loading);
  const setRange = useIntelStore((s) => s.setRange);
  const setDatasets = useIntelStore((s) => s.setDatasets);
  const select = useIntelStore((s) => s.select);
  const selectedId = useIntelStore((s) => s.selected?.id ?? null);
  const fr = locale === "fr";

  const range = TIME_RANGES.find((r) => r.key === filters.range);
  const rangeLabel = range ? range.label.toLowerCase() : filters.range;
  const sources = stats?.sources ?? [];
  const byNature = (nature: ConflictNature) => sources.filter((s) => natureOfSource(s) === nature);
  const sum = (list: SourceAvailability[]) => list.reduce((n, s) => n + s.recordsInSelection, 0);
  const latest = (list: SourceAvailability[]) =>
    list.map((s) => s.latestEventAt).filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;

  const press = byNature("press");
  const verified = byNature("verified");
  const satellite = byNature("satellite");
  const verifiedLatest = latest(verified);
  const verifiedNames = verified.filter((s) => s.recordsInStore > 0).map((s) => SOURCE_NAMES[s.dataset] ?? s.dataset.toUpperCase());
  const active = activeNatures(filters.datasets);
  const acled = stats?.connectors.find((c) => c.id === "acled");

  const zones = useMemo(
    () => [...clusters].sort((a, b) => b.eventCount - a.eventCount || b.lastEventAt.localeCompare(a.lastEventAt)).slice(0, 40),
    [clusters],
  );

  const toggle = (nature: ConflictNature) => {
    const next = toggleNature(filters.datasets, nature);
    if (next) setDatasets(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-3">
        <div className="section-title">{tr(locale, "Période", "Period")}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={tr(locale, "Période des données de conflit", "Conflict data period")}>
          {TIME_RANGES.map((r) => (
            <button key={r.key} type="button" className="chip" data-active={filters.range === r.key} aria-pressed={filters.range === r.key} onClick={() => setRange(r.key as TimeRangeKey)}>
              {fr ? r.label : r.label.replace(" J", " D").replace(" MOIS", " MO").replace(" AN", " YR")}
            </button>
          ))}
        </div>
        {filters.at ? <p className="meta mt-1">{tr(locale, "Archive jusqu'au", "Archive until")} {shortDate(filters.at, locale)}</p> : null}
      </div>

      <div className="mt-3 grid gap-2 px-4">
        <Counter
          tone="press"
          title={tr(locale, "Articles de presse", "Press articles")}
          value={stats ? int(sum(press)) : "…"}
          hint={tr(
            locale,
            `GDELT · ${rangeLabel} · un article × un lieu cité · non confirmés, sans bilan humain`,
            `GDELT · ${rangeLabel} · one article × one place mentioned · unconfirmed, no casualty count`,
          )}
        />
        <Counter
          tone="verified"
          title={
            verifiedLatest
              ? tr(locale, `Incidents vérifiés (${verifiedNames.join(", ") || "UCDP"}, jusqu'au ${shortDate(verifiedLatest, locale)})`, `Verified incidents (${verifiedNames.join(", ") || "UCDP"}, up to ${shortDate(verifiedLatest, locale)})`)
              : tr(locale, "Incidents vérifiés", "Verified incidents")
          }
          value={stats ? int(sum(verified)) : "…"}
          hint={
            !stats
              ? "…"
              : sum(verified) > 0
                ? tr(locale, `${int(stats.fatalitiesRange)} morts rapportés par la source sur la période`, `${int(stats.fatalitiesRange)} deaths reported by the source over the period`)
                : verifiedLatest
                  ? tr(locale, `Aucun sur ${rangeLabel} : publication différée, dernières données du ${shortDate(verifiedLatest, locale)}. Élargir à 6 mois ou 1 an.`, `None over ${rangeLabel}: delayed publication, latest data ${shortDate(verifiedLatest, locale)}. Widen to 6 months or 1 year.`)
                  : tr(locale, "Aucune source d'incidents vérifiés disponible.", "No verified-incident source available.")
          }
        />
        <Counter
          tone="satellite"
          title={tr(locale, "Détections satellite", "Satellite detections")}
          value={stats ? int(sum(satellite)) : "…"}
          hint={tr(
            locale,
            `NASA FIRMS · anomalies thermiques (feux, industrie…), pas des combats${latest(satellite) ? ` · dernière ${relativeTime(latest(satellite), locale, now)}` : ""}`,
            `NASA FIRMS · thermal anomalies (fires, industry…), not fighting${latest(satellite) ? ` · latest ${relativeTime(latest(satellite), locale, now)}` : ""}`,
          )}
        />
        {acled && !acled.configured ? (
          <p className="meta">{tr(locale, "ACLED : non branché (identifiants absents).", "ACLED: not connected (no credentials).")}</p>
        ) : null}
      </div>

      <div className="px-4 pt-3">
        <div className="section-title">{tr(locale, "Afficher sur le globe", "Show on globe")}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(
            [
              ["press", tr(locale, "Presse", "Press")],
              ["verified", tr(locale, "Incidents vérifiés", "Verified incidents")],
              ["satellite", tr(locale, "Satellite", "Satellite")],
            ] as const
          ).map(([nature, text]) => (
            <button key={nature} type="button" className="chip" data-active={active.has(nature)} aria-pressed={active.has(nature)} onClick={() => toggle(nature)}>
              {text}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-baseline justify-between px-4">
        <span className="section-title">{tr(locale, "Zones signalées", "Reported areas")}</span>
        <span className="meta">{loading ? tr(locale, "mise à jour…", "updating…") : `${clusters.length} ${tr(locale, "zones", "areas")}`}</span>
      </div>
      <ul className="scroll-thin mt-1 min-h-0 flex-1 overflow-y-auto pb-2">
        {zones.map((c) => {
          const b = clusterBreakdown(c);
          return (
            <li key={c.id}>
              <button type="button" className="zone-row" data-active={selectedId === c.id} onClick={() => void select(c)}>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="break-words text-[13px] text-[#e3f3ff]">{c.locality || c.region || c.country || "—"}</span>
                  <span className="meta shrink-0" title={absoluteDateTime(c.lastEventAt, locale)}>
                    {relativeTime(c.lastEventAt, locale, now)}
                  </span>
                </span>
                <span className="block break-words text-[11px] text-[#8fb4cc]">
                  {c.country ? `${c.country} · ` : ""}
                  {clusterSummary(c, locale)}
                  {b.fatalities ? ` · ${int(b.fatalities)} ${tr(locale, "morts (source)", "deaths (source)")}` : ""}
                  {precisionLabel(clusterPrecision(c), locale) ? ` · ${precisionLabel(clusterPrecision(c), locale)}` : ""}
                </span>
              </button>
            </li>
          );
        })}
        {!zones.length && !loading ? (
          <li className="empty-note">{tr(locale, `Aucune zone signalée sur ${rangeLabel} dans les sources affichées.`, `No reported area over ${rangeLabel} in the displayed sources.`)}</li>
        ) : null}
      </ul>
    </div>
  );
}
