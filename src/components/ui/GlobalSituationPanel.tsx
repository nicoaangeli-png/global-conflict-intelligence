"use client";

import { CONFLICT } from "@/lib/config/visual";
import { compact, dateTimeUTC, int, relative } from "@/lib/format";
import { useIntelStore } from "@/store/useIntelStore";
import { t } from "@/lib/i18n";
import type { ConflictCluster } from "@/types/conflict";

/**
 * Panneau « GLOBAL SITUATION ».
 * Toutes les valeurs proviennent de l'agrégat serveur.
 * Traduction automatique selon la langue sélectionnée (FR/EN).
 */

function Sparkline({ data, accent }: { data: { events: number; fatalities: number }[]; accent?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.events));
  return (
    <div className="tick-marks flex h-10 items-end gap-[2px] border-b border-[rgba(127,212,255,0.12)] pb-[1px]">
      {data.map((d, i) => {
        const h = Math.max(2, (d.events / max) * 34);
        const hot = d.fatalities > 0;
        return (
          <div
            key={i}
            title={`${d.events} événement(s)`}
            className="flex-1"
            style={{
              height: `${h}px`,
              background: hot
                ? accent
                  ? "linear-gradient(180deg, rgba(255,138,61,0.9), rgba(255,74,47,0.25))"
                  : "linear-gradient(180deg, rgba(255,74,47,0.75), rgba(255,74,47,0.18))"
                : "linear-gradient(180deg, rgba(127,212,255,0.5), rgba(127,212,255,0.1))",
            }}
          />
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  hint,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  accent?: "alert" | "cyan";
}) {
  return (
    <div className="flex items-baseline justify-between py-[7px]">
      <div className="flex flex-col">
        <span className="label">{label}</span>
        {hint ? <span className="readout mt-[2px] text-[9px] text-text-faint">{hint}</span> : null}
      </div>
      <div className="flex items-baseline gap-1">
        <span
          className="value text-[19px] font-light leading-none"
          style={{
            color: accent === "alert" ? "#ff9a80" : undefined,
          }}
        >
          {value}
        </span>
        {unit ? <span className="label-strong text-[8px]">{unit}</span> : null}
      </div>
    </div>
  );
}

function ZoneRow({ zone, index }: { zone: ConflictCluster; index: number }) {
  const select = useIntelStore((s) => s.select);
  const selected = useIntelStore((s) => s.selected?.id === zone.id);

  return (
    <button
      type="button"
      className="row-button group flex items-center gap-2"
      data-active={selected}
      onClick={() => void select(zone)}
    >
      <span className="readout w-4 shrink-0 text-[9px] text-text-faint">{String(index + 1).padStart(2, "0")}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[11px] font-light tracking-wide text-text">{zone.country || "—"}</span>
          {zone.locality ? (
            <span className="truncate text-[9px] uppercase tracking-[0.14em] text-text-faint">{zone.locality}</span>
          ) : null}
        </span>
        <span className="mt-[3px] flex items-center gap-2">
          <span className="h-[2px] flex-1 bg-[rgba(127,212,255,0.08)]">
            <span
              className="block h-full"
              style={{
                width: `${Math.round(zone.intensity * 100)}%`,
                background: `linear-gradient(90deg, ${CONFLICT.markerBarFrom}, ${CONFLICT.markerBarTo})`,
                boxShadow: "0 0 8px -1px rgba(255,74,47,0.7)",
              }}
            />
          </span>
          <span className="readout text-[9px] text-text-faint">
            {zone.eventCount}
            {zone.fatalities > 0 ? ` · ${compact(zone.fatalities)}†` : ""}
          </span>
        </span>
      </span>
    </button>
  );
}

export function GlobalSituationPanel() {
  const stats = useIntelStore((s) => s.stats);
  const clusters = useIntelStore((s) => s.clusters);
  const at = useIntelStore((s) => s.filters.at);
  const locale = useIntelStore((s) => s.locale);

  const dict = t(locale);
  const daily = stats?.daily ?? [];
  const top = clusters.slice(0, 6);
  const major = clusters.filter((c) => c.intensity >= 0.5).length;

  return (
    <section className="panel corners boot w-[268px]">
      <span className="corner" />
      <div className="sweep" />
      <div className="flex items-center justify-between px-3 pt-[10px]">
        <span className="label-strong">{dict.globalSituation.title}</span>
        <span className="readout text-[9px]">
          {at ? (locale === "fr" ? "ARCHIVE" : "HISTORICAL") : (locale === "fr" ? "TEMPS RÉEL" : "REAL-TIME")}
        </span>
      </div>
      <div className="hairline mx-3 mt-2" />

      <div className="px-3 pt-1">
        <Stat
          label={dict.globalSituation.activeHotspots}
          value={int(stats?.activeZones)}
          hint={locale === "fr" ? `dont ${major} théâtres majeurs` : `incl. ${major} major theaters`}
          accent="alert"
        />
        <div className="hairline" />
        <Stat
          label={dict.globalSituation.recorded24h}
          value={int(stats?.events24h)}
          hint={locale === "fr" ? "toutes sources confondues" : "all sources combined"}
        />
        <div className="hairline" />
        <Stat
          label={locale === "fr" ? "Événements (7 jours)" : "Incidents (7 days)"}
          value={int(stats?.events7d)}
        />
        <div className="hairline" />
        <Stat
          label={dict.globalSituation.fatalitiesWindow}
          value={compact(stats?.fatalitiesRange)}
          unit="†"
          hint={locale === "fr" ? "cumul sur la période" : "cumulative casualties"}
          accent="alert"
        />
        <div className="hairline" />
        <div className="flex items-baseline justify-between py-[7px]">
          <span className="label">{dict.globalSituation.temporalCurve}</span>
          <span className="readout text-[9px]">{gridLabel(stats?.range, locale)}</span>
        </div>
        <Sparkline data={daily.slice(-28)} />
        <div className="mt-[6px] flex items-center justify-between">
          <span className="readout text-[9px]">{daily.length ? daily[0].day : "—"}</span>
          <span className="readout text-[9px]">{daily.length ? daily[daily.length - 1].day : "—"}</span>
        </div>
      </div>

      <div className="hairline mx-3 mt-3" />
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="label-strong">{dict.globalSituation.topTheaters}</span>
        <span className="readout text-[9px]">{locale === "fr" ? "intensité" : "intensity"}</span>
      </div>
      <div className="max-h-[228px] overflow-y-auto py-1 scroll-thin">
        {top.length ? (
          top.map((z, i) => <ZoneRow key={z.id} zone={z} index={i} />)
        ) : (
          <div className="px-3 py-4 text-[10px] text-text-faint">
            {locale === "fr" ? "aucun foyer sur la période" : "no clusters in this period"}
          </div>
        )}
      </div>

      <div className="hairline mx-3" />
      <div className="flex items-center justify-between px-3 py-2">
        <span className="label">{locale === "fr" ? "Dernière mise à jour" : "Latest sync"}</span>
        <span className="readout text-[9px]" title={dateTimeUTC(stats?.lastDataUpdate)}>
          {relative(stats?.lastDataUpdate)}
        </span>
      </div>
    </section>
  );
}

function gridLabel(range: string | undefined, locale: "fr" | "en") {
  if (range === "24h") return locale === "fr" ? "HORAIRE" : "HOURLY";
  if (range === "1y" || range === "6m") return locale === "fr" ? "HEBDO" : "WEEKLY";
  return locale === "fr" ? "JOURNALIER" : "DAILY";
}
