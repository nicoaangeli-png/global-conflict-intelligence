"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TIME_RANGES, type DailyBucket, type TimeRangeKey } from "@/types/conflict";
import { useIntelStore } from "@/store/useIntelStore";
import { int } from "@/lib/format";

/**
 * Timeline horizontale.
 *
 * La frise de fond couvre toujours les douze derniers mois (référence stable).
 * Le curseur choisit la FIN de la fenêtre analysée : les bandes de temps
 * sélectionnables (24 H → 1 AN) définissent sa largeur. Le bouton de lecture
 * rejoue la situation pas à pas — chaque pas réinterroge l'agrégat serveur.
 */

export function Timeline() {
  const filters = useIntelStore((s) => s.filters);
  const setRange = useIntelStore((s) => s.setRange);
  const setAt = useIntelStore((s) => s.setAt);
  const stats = useIntelStore((s) => s.stats);

  const [year, setYear] = useState<DailyBucket[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const lastIngest = stats?.lastIngestAt;

  // Frise de référence : 12 mois (indépendante des filtres de fenêtre)
  useEffect(() => {
    let alive = true;
    fetch("/api/stats?range=1y", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: { daily: DailyBucket[] }) => {
        if (alive) setYear(s.daily ?? []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [lastIngest]);

  const span = useMemo(() => {
    if (!year.length) return null;
    const start = Date.parse(year[0].day);
    const end = Date.parse(year[year.length - 1].day) + 7 * 86400e3;
    return { start, end, total: end - start };
  }, [year]);

  const windowDays = TIME_RANGES.find((r) => r.key === filters.range)?.days ?? 30;

  /** Position (0..1) du curseur sur la frise. */
  const cursorRatio = useMemo(() => {
    if (!span) return 1;
    const t = filters.at ? Date.parse(filters.at) : Date.now();
    return Math.min(1, Math.max(0, (t - span.start) / span.total));
  }, [filters.at, span]);

  const windowWidth = span ? Math.min(1, (windowDays * 86400e3) / span.total) : 0;

  const ratioFromEvent = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    },
    [],
  );

  const commit = useCallback(
    (ratio: number) => {
      if (!span) return;
      const t = span.start + ratio * span.total;
      // curseur à moins d'une journée de « maintenant » → retour au temps réel
      const isLive = Date.now() - t < 12 * 3600e3;
      setAt(isLive ? null : new Date(t).toISOString());
    },
    [setAt, span],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    scrubbing.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const r = ratioFromEvent(e.clientX);
    if (r != null) commit(r);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const r = ratioFromEvent(e.clientX);
    if (r == null) return;
    setHoverIndex(Math.min(year.length - 1, Math.floor(r * year.length)));
    if (scrubbing.current) commit(r);
  };

  // Lecture : avance le curseur par pas d'une demi-fenêtre
  useEffect(() => {
    if (!playing) return;
    const step = Math.max(1, Math.round((windowDays / 6) * 86400e3));
    const id = setInterval(() => {
      const current = filters.at ? Date.parse(filters.at) : Date.now();
      const next = current + step;
      if (next >= Date.now()) {
        setAt(null);
        setPlaying(false);
        return;
      }
      setAt(new Date(next).toISOString());
    }, 900);
    return () => clearInterval(id);
  }, [playing, filters.at, setAt, windowDays]);

  const hovered = hoverIndex != null ? year[hoverIndex] : null;
  const max = Math.max(1, ...year.map((d) => d.events));

  return (
    <section className="panel corners boot w-full">
      <span className="corner" />
      <div className="flex items-stretch gap-4 px-3 py-2">
        {/* Sélecteurs de fenêtre */}
        <div className="flex flex-col justify-between">
          <span className="label">Fenêtre</span>
          <div className="mt-1 flex items-center gap-[6px]">
            {TIME_RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                className="chip"
                data-active={filters.range === r.key}
                onClick={() => setRange(r.key as TimeRangeKey)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="w-px bg-[rgba(127,212,255,0.14)]" />

        {/* Frise */}
        <div className="relative min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span className="label">
              {span ? `Frise 12 mois · ${year.length} intervalles` : "chargement de la frise…"}
            </span>
            <span className="readout text-[9px]">
              {hovered
                ? `${hovered.day} · ${int(hovered.events)} événements · ${int(hovered.fatalities)} †`
                : filters.at
                  ? `archive ${filters.at.slice(0, 10)}`
                  : "temps réel"}
            </span>
          </div>

          <div
            ref={trackRef}
            className="relative mt-1 h-[46px] cursor-crosshair select-none border border-[rgba(127,212,255,0.1)] bg-[rgba(3,12,22,0.5)]"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => {
              scrubbing.current = false;
            }}
            onPointerLeave={() => {
              setHoverIndex(null);
              scrubbing.current = false;
            }}
          >
            {/* bandes : 1 barre par intervalle */}
            <div className="absolute inset-0 flex items-end gap-[1px] px-[2px] pb-[2px]">
              {year.map((d, i) => {
                const h = Math.max(2, Math.sqrt(d.events / max) * 40);
                const hot = d.fatalities > 0;
                const inWindow = i / year.length >= cursorRatio - windowWidth;
                return (
                  <div
                    key={d.day}
                    className="flex-1 transition-opacity duration-200"
                    style={{
                      height: `${h}px`,
                      opacity: inWindow ? 1 : 0.32,
                      background: hot
                        ? "linear-gradient(180deg, rgba(255,120,70,0.95), rgba(255,74,47,0.25))"
                        : "linear-gradient(180deg, rgba(127,212,255,0.65), rgba(127,212,255,0.12))",
                    }}
                  />
                );
              })}
            </div>

            {/* fenêtre analysée */}
            <div
              className="pointer-events-none absolute inset-y-0 border-x border-[rgba(255,74,47,0.55)] bg-[rgba(255,74,47,0.055)]"
              style={{ left: `${Math.max(0, cursorRatio - windowWidth) * 100}%`, width: `${windowWidth * 100}%` }}
            />

            {/* curseur */}
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-cyan"
              style={{ left: `${cursorRatio * 100}%`, boxShadow: "0 0 10px rgba(127,212,255,0.9)" }}
            >
              <div className="absolute -top-[3px] -left-[3px] h-[7px] w-[7px] rotate-45 border border-cyan bg-void" />
            </div>

            {/* survol */}
            {hovered ? (
              <div
                className="pointer-events-none absolute inset-y-0 w-px bg-[rgba(223,242,255,0.35)]"
                style={{ left: `${((hoverIndex! + 0.5) / year.length) * 100}%` }}
              />
            ) : null}
          </div>
        </div>

        <div className="w-px bg-[rgba(127,212,255,0.14)]" />

        {/* Commandes */}
        <div className="flex w-[132px] flex-col justify-between">
          <span className="label">Reconstruction</span>
          <div className="mt-1 flex items-center gap-[6px]">
            <button
              type="button"
              className="chip"
              data-active={playing}
              onClick={() => setPlaying((p) => !p)}
              title="Rejouer la situation dans le temps"
            >
              {playing ? "pause" : "lecture"}
            </button>
            <button
              type="button"
              className="chip"
              data-active={!filters.at}
              onClick={() => {
                setPlaying(false);
                setAt(null);
              }}
            >
              live
            </button>
          </div>
          <span className="readout mt-1 text-[9px]">
            {filters.at ? `fin ${filters.at.slice(0, 10)}` : "fin maintenant"}
          </span>
        </div>
      </div>
    </section>
  );
}
