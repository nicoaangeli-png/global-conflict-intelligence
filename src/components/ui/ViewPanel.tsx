"use client";

import { useEffect, useMemo, useState } from "react";
import { compact, dateTimeUTC, int, relative } from "@/lib/format";
import { useIntelStore } from "@/store/useIntelStore";
import { getCountryGeopolitics } from "@/data/geopolitics";
import { t } from "@/lib/i18n";
import type { ConflictEvent } from "@/types/conflict";
import type { ViewKey } from "./Header";

/**
 * Panneaux de vue (nav) : LIVE EVENTS, REGIONS, SOURCES, CONFLICTS.
 * Intégration du profil géopolitique et du bilinguisme FR/EN.
 */

function useDebouncedRefresh(key: string, ms = 400) {
  const [tick, setTick] = useState(0);
  const lastSync = useIntelStore((s) => s.lastSync);
  useEffect(() => {
    const id = setTimeout(() => setTick((t) => t + 1), ms);
    return () => clearTimeout(id);
  }, [key, lastSync, ms]);
  return tick;
}

export function ViewPanel({ view, onClose }: { view: ViewKey; onClose: () => void }) {
  if (view === "LIVE EVENTS") return <LiveEventsView onClose={onClose} />;
  if (view === "REGIONS") return <RegionsView onClose={onClose} />;
  if (view === "SOURCES") return <SourcesView onClose={onClose} />;
  if (view === "CONFLICTS") return <ConflictsView onClose={onClose} />;
  return null;
}

function Shell({
  title,
  hint,
  onClose,
  children,
}: {
  title: string;
  hint: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="panel corners boot flex max-h-[62vh] w-[340px] flex-col">
      <span className="corner" />
      <div className="flex items-center justify-between px-3 pt-[10px]">
        <span className="label-strong">{title}</span>
        <button type="button" className="chip" style={{ padding: "2px 6px" }} onClick={onClose}>
          esc
        </button>
      </div>
      <div className="hairline mx-3 mt-2" />
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="readout text-[9px]">{hint}</span>
      </div>
      <div className="scroll-thin mt-1 flex-1 overflow-y-auto px-3 pb-3">{children}</div>
    </section>
  );
}

function LiveEventsView({ onClose }: { onClose: () => void }) {
  const filters = useIntelStore((s) => s.filters);
  const locale = useIntelStore((s) => s.locale);
  const [events, setEvents] = useState<ConflictEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const key = JSON.stringify(filters);
  const tick = useDebouncedRefresh(key, 250);

  useEffect(() => {
    const params = new URLSearchParams({ range: filters.range, limit: "80" });
    if (filters.types.length) params.set("types", filters.types.join(","));
    if (filters.confidences.length) params.set("confidences", filters.confidences.join(","));
    if (filters.minFatalities) params.set("minFatalities", String(filters.minFatalities));
    if (filters.at) params.set("at", filters.at);
    let alive = true;
    setLoading(true);
    fetch(`/api/latest?${params}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { events: ConflictEvent[] }) => {
        if (!alive) return;
        setEvents(d.events ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [filters, tick]);

  return (
    <Shell
      title={locale === "fr" ? "Événements en direct" : "Live Events Stream"}
      hint={`${events.length} ${locale === "fr" ? "incidents récents indexés" : "recent incidents indexed"}`}
      onClose={onClose}
    >
      {events.map((e) => (
        <div key={e.id} className="border-b border-[rgba(127,212,255,0.08)] py-2 text-[10px]">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-light text-text">{e.country} · {e.locality || e.region || "—"}</span>
            <span className="readout text-[9px] text-alert">{e.fatalities > 0 ? `${e.fatalities} †` : "0 †"}</span>
          </div>
          <div className="mt-0.5 flex items-baseline justify-between text-[9px] text-text-faint">
            <span>{e.eventType}</span>
            <span className="readout">{relative(e.eventDate)}</span>
          </div>
        </div>
      ))}
      {!events.length && !loading ? (
        <div className="py-4 text-[10px] text-text-faint">
          {locale === "fr" ? "aucun événement pour ces filtres" : "no events matching filters"}
        </div>
      ) : null}
    </Shell>
  );
}

function RegionsView({ onClose }: { onClose: () => void }) {
  const clusters = useIntelStore((s) => s.clusters);
  const select = useIntelStore((s) => s.select);
  const locale = useIntelStore((s) => s.locale);

  const regions = useMemo(() => {
    const map = new Map<string, { country: string; events: number; fatalities: number; zones: number; intensity: number; best: (typeof clusters)[number] }>();
    for (const c of clusters) {
      const key = c.country || "—";
      const cur = map.get(key);
      if (cur) {
        cur.events += c.eventCount;
        cur.fatalities += c.fatalities;
        cur.zones += 1;
        cur.intensity = Math.max(cur.intensity, c.intensity);
        if (c.intensity > cur.best.intensity) cur.best = c;
      } else {
        map.set(key, {
          country: key,
          events: c.eventCount,
          fatalities: c.fatalities,
          zones: 1,
          intensity: c.intensity,
          best: c,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.fatalities - a.fatalities || b.events - a.events);
  }, [clusters]);

  const max = Math.max(1, ...regions.map((r) => r.fatalities));

  return (
    <Shell
      title={locale === "fr" ? "Géopolitique Régionale" : "Regional Geopolitics"}
      hint={`${regions.length} ${locale === "fr" ? "pays dans la fenêtre analysée" : "countries in observed window"}`}
      onClose={onClose}
    >
      {regions.map((r) => {
        const geo = getCountryGeopolitics(r.country);
        return (
          <button
            key={r.country}
            type="button"
            className="row-button flex items-center justify-between gap-3 text-left"
            onClick={() => void select(r.best)}
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[11px] font-light text-text">{r.country}</span>
                <span className="readout shrink-0 text-[9px]">{int(r.fatalities)} †</span>
              </span>

              {/* Régime du pays */}
              <span className="mt-0.5 block truncate text-[8px] font-mono text-cyan">
                {locale === "fr" ? geo.regime.labelFr : geo.regime.labelEn}
              </span>

              <span className="mt-[3px] block h-[2px] w-full bg-[rgba(127,212,255,0.08)]">
                <span
                  className="block h-full"
                  style={{
                    width: `${Math.round((r.fatalities / max) * 100)}%`,
                    background: "linear-gradient(90deg, #ff8a3d, #ff3b30)",
                  }}
                />
              </span>
              <span className="mt-[3px] block text-[9px] uppercase tracking-[0.14em] text-text-faint">
                {r.zones} {locale === "fr" ? "foyers" : "hotspots"} · {r.events} {locale === "fr" ? "événements" : "events"}
              </span>
            </span>
          </button>
        );
      })}
      {!regions.length ? (
        <div className="py-4 text-[10px] text-text-faint">
          {locale === "fr" ? "aucune région active" : "no active regions"}
        </div>
      ) : null}
    </Shell>
  );
}

function ConflictsView({ onClose }: { onClose: () => void }) {
  const clusters = useIntelStore((s) => s.clusters);
  const select = useIntelStore((s) => s.select);
  const locale = useIntelStore((s) => s.locale);

  return (
    <Shell
      title={locale === "fr" ? "Théâtres de Guerre" : "Active War Theaters"}
      hint={`${clusters.length} ${locale === "fr" ? "foyers classés par intensité" : "hotspots ranked by intensity"}`}
      onClose={onClose}
    >
      <div className="py-1">
        {clusters.slice(0, 40).map((c, i) => (
          <button
            key={c.id}
            type="button"
            className="row-button flex items-center gap-2 text-left"
            onClick={() => void select(c)}
          >
            <span className="readout w-5 shrink-0 text-[9px] text-text-faint">{String(i + 1).padStart(2, "0")}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[11px] font-light text-text">
                  {c.locality || c.region || c.country}
                </span>
                <span className="readout shrink-0 text-[9px] text-alert">{(c.intensity * 100).toFixed(0)}%</span>
              </span>
              <span className="mt-[2px] block truncate text-[9px] uppercase tracking-[0.14em] text-text-faint">
                {c.country} · {c.topType} · {c.eventCount} {locale === "fr" ? "év." : "ev."} · {compact(c.fatalities)} †
              </span>
            </span>
          </button>
        ))}
      </div>
    </Shell>
  );
}

function SourcesView({ onClose }: { onClose: () => void }) {
  const stats = useIntelStore((s) => s.stats);
  const refresh = useIntelStore((s) => s.refresh);
  const locale = useIntelStore((s) => s.locale);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);

  const connectors = stats?.connectors ?? [];

  const runIngest = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/ingest", { method: "POST" });
      const data = (await res.json()) as { report?: string };
      setReport(data.report ?? null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={locale === "fr" ? "Sources de renseignement" : "Intelligence Sources"}
      hint={locale === "fr" ? "connecteurs et état d'ingestion" : "connectors & ingestion status"}
      onClose={onClose}
    >
      <div className="space-y-[6px] py-1">
        {connectors.map((c) => (
          <div key={c.id} className="border border-[rgba(127,212,255,0.1)] bg-[rgba(4,14,26,0.5)] p-[8px]">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span
                  className="dot"
                  style={{
                    color: c.reachable === false ? "#ff4a2f" : c.configured ? "#7fd4ff" : "#4a6f88",
                  }}
                />
                <span className="text-[11px] font-light tracking-wide text-text">{c.label}</span>
              </span>
              <span className="readout text-[9px]">
                {int(c.events)} {locale === "fr" ? "événements" : "events"}
              </span>
            </div>
            <p className="mt-[5px] text-[9px] leading-relaxed text-text-faint">{c.note}</p>
          </div>
        ))}
      </div>

      <div className="hairline my-2" />
      <button type="button" className="chip" data-active={busy} onClick={() => void runIngest()} disabled={busy}>
        {busy ? (locale === "fr" ? "ingestion en cours…" : "ingesting…") : locale === "fr" ? "lancer une ingestion" : "trigger ingest"}
      </button>
      {report ? <p className="mt-2 text-[9px] leading-relaxed text-text-dim">{report}</p> : null}
      <p className="mt-3 text-[9px] leading-relaxed text-text-faint">
        {locale === "fr"
          ? "Les identifiants restent côté serveur (variables d'environnement). L'interface n'expose jamais un jeton, et GDELT n'est jamais présenté comme une confirmation."
          : "Credentials remain strictly server-side. The interface never exposes tokens, and GDELT press signals are never marked as definitive confirmations."}
      </p>
    </Shell>
  );
}
