"use client";

import { useIntelStore } from "@/store/useIntelStore";

const VIEWS = ["OVERVIEW", "LIVE EVENTS", "CONFLICTS", "TIMELINE", "REGIONS", "SOURCES"] as const;
export type ViewKey = (typeof VIEWS)[number] | "SETUP";

/**
 * En-tête : identité du système, navigation, état du flux.
 * Le voyant de flux reflète réellement la connexion SSE (pas une décoration).
 */
export function Header({
  view,
  onView,
}: {
  view: ViewKey;
  onView: (v: ViewKey) => void;
}) {
  const streamStatus = useIntelStore((s) => s.streamStatus);
  const stats = useIntelStore((s) => s.stats);
  const loading = useIntelStore((s) => s.loading);

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 select-none">
      <div className="flex items-start justify-between gap-6 px-5 pt-4 md:px-7">
        <div className="boot">
          <div className="flex items-baseline gap-3">
            <span className="text-[13px] font-extralight tracking-[0.5em] text-ice">ORBITAL</span>
            <span className="label-strong translate-y-[-1px]">Conflict Intelligence</span>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <span className="label">Global Conflict Intelligence System</span>
            <span className="hairline w-24" />
            <span className="readout">v0.1</span>
          </div>
        </div>

        <nav className="pointer-events-auto hidden items-center gap-6 md:flex">
          {VIEWS.map((v) => (
            <button
              key={v}
              className="nav-item"
              data-active={v === view}
              onClick={() => onView(v)}
              type="button"
            >
              {v}
            </button>
          ))}
          <button className="nav-item" data-active={view === "SETUP"} onClick={() => onView("SETUP")} type="button">
            config
          </button>
        </nav>

        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <span
              className={`dot blink ${streamStatus === "open" ? "text-cyan" : streamStatus === "connecting" ? "text-alert-soft" : "text-alert"}`}
            />
            <span className="label">
              {streamStatus === "open" ? "flux actif" : streamStatus === "connecting" ? "connexion" : "flux interrompu"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`dot ${loading ? "text-alert-soft blink" : "text-cyan-dim"}`} />
            <span className="label">{loading ? "agrégation" : "synchronisé"}</span>
          </div>
          <div className="readout text-right">
            {stats ? `${stats.totalInStore.toLocaleString("fr-FR")} événements indexés` : "—"}
          </div>
        </div>
      </div>

      <div className="hairline mx-5 mt-3 md:mx-7" />
    </header>
  );
}
