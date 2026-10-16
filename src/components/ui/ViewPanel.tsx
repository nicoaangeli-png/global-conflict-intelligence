"use client";

import { useEffect, useMemo, useState } from "react";
import { compact, dateTimeUTC, int, relative } from "@/lib/format";
import { useIntelStore } from "@/store/useIntelStore";
import type { ConflictEvent } from "@/types/conflict";
import type { ViewKey } from "./Header";

/**
 * Panneaux de vue (nav) : LIVE EVENTS, REGIONS, SOURCES.
 * Chaque vue consomme une API différente — aucune donnée de démonstration
 * n'est fabriquée côté client.
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
        if (alive) {
          setEvents(d.events ?? []);
          setLoading(false);
        }
      })
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  return (
    <Shell title="Live Events" hint={loading ? "chargement…" : `${events.length} derniers événements`} onClose={onClose}>
      {events.map((e) => (
        <div key={e.id} className="border-b border-[rgba(127,212,255,0.07)] py-[6px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[11px] font-light text-text">
              {e.locality || e.region || e.country || "—"}
            </span>
            <span className="readout shrink-0 text-[9px] text-text-dim">{dateTimeUTC(e.eventDate)}</span>
          </div>
          <div className="mt-[2px] flex items-baseline justify-between gap-3">
            <span className="truncate text-[9px] uppercase tracking-[0.14em] text-text-faint">
              {e.country} · {e.subEventType || e.eventType}
            </span>
            <span className="readout shrink-0 text-[9px]" style={{ color: e.fatalities ? "#ff9a80" : undefined }}>
              {e.fatalities} †
            </span>
          </div>
          <div className="mt-[2px] flex items-center justify-between gap-2">
            <span className="truncate text-[8px] uppercase tracking-[0.14em] text-text-faint">
              {e.source || e.sourceDataset}
            </span>
            <span className="readout shrink-0 text-[8px]">
              {e.confidence} · {relative(e.updatedAt)}
            </span>
          </div>
        </div>
      ))}
      {!events.length && !loading ? (
        <div className="py-4 text-[10px] text-text-faint">aucun événement pour ces filtres</div>
      ) : null}
    </Shell>
  );
}

function RegionsView({ onClose }: { onClose: () => void }) {
  const clusters = useIntelStore((s) => s.clusters);
  const select = useIntelStore((s) => s.select);

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
    <Shell title="Regions" hint={`${regions.length} pays dans la fenêtre analysée`} onClose={onClose}>
      {regions.map((r) => (
        <button
          key={r.country}
          type="button"
          className="row-button flex items-center justify-between gap-3"
          onClick={() => void select(r.best)}
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[11px] font-light text-text">{r.country}</span>
              <span className="readout shrink-0 text-[9px]">{int(r.fatalities)} †</span>
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
              {r.zones} foyers · {r.events} événements
            </span>
          </span>
        </button>
      ))}
      {!regions.length ? <div className="py-4 text-[10px] text-text-faint">aucune région active</div> : null}
    </Shell>
  );
}

function ConflictsView({ onClose }: { onClose: () => void }) {
  const clusters = useIntelStore((s) => s.clusters);
  const select = useIntelStore((s) => s.select);

  return (
    <Shell title="Conflicts" hint={`${clusters.length} foyers · tri par intensité`} onClose={onClose}>
      <div className="py-1">
        {clusters.slice(0, 40).map((c, i) => (
          <button
            key={c.id}
            type="button"
            className="row-button flex items-center gap-2"
            onClick={() => void select(c)}
          >
            <span className="readout w-5 shrink-0 text-[9px] text-text-faint">{String(i + 1).padStart(2, "0")}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[11px] font-light text-text">
                  {c.locality || c.region || c.country}
                </span>
                <span className="readout shrink-0 text-[9px]">{(c.intensity * 100).toFixed(0)}%</span>
              </span>
              <span className="mt-[2px] block truncate text-[9px] uppercase tracking-[0.14em] text-text-faint">
                {c.country} · {c.topType} · {c.eventCount} év. · {compact(c.fatalities)} †
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
    <Shell title="Sources" hint="connecteurs et état d'ingestion" onClose={onClose}>
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
              <span className="readout text-[9px]">{int(c.events)} événements</span>
            </div>
            <p className="mt-[5px] text-[9px] leading-relaxed text-text-faint">{c.note}</p>
          </div>
        ))}
      </div>

      <div className="hairline my-2" />
      <button type="button" className="chip" data-active={busy} onClick={() => void runIngest()} disabled={busy}>
        {busy ? "ingestion en cours…" : "lancer une ingestion"}
      </button>
      {report ? <p className="mt-2 text-[9px] leading-relaxed text-text-dim">{report}</p> : null}
      <p className="mt-3 text-[9px] leading-relaxed text-text-faint">
        Les identifiants restent côté serveur (variables d&apos;environnement). L&apos;interface n&apos;expose jamais un
        jeton, et GDELT n&apos;est jamais présenté comme une confirmation.
      </p>
    </Shell>
  );
}
