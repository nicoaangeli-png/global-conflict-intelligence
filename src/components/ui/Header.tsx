"use client";

import { useIntelStore } from "@/store/useIntelStore";
import { t } from "@/lib/i18n";

export type ViewKey =
  | "OVERVIEW"
  | "LIVE EVENTS"
  | "CONFLICTS"
  | "TIMELINE"
  | "REGIONS"
  | "SOURCES"
  | "SETUP";

/**
 * En-tête : identité du système, navigation, état du flux et sélecteur bilingue (FR/EN).
 * Le voyant de flux reflète réellement la connexion SSE.
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
  const locale = useIntelStore((s) => s.locale);
  const setLocale = useIntelStore((s) => s.setLocale);

  const dict = t(locale);

  const navItems: { key: ViewKey; label: string }[] = [
    { key: "OVERVIEW", label: dict.nav.overview },
    { key: "LIVE EVENTS", label: dict.nav.liveEvents },
    { key: "CONFLICTS", label: dict.nav.conflicts },
    { key: "TIMELINE", label: dict.nav.timeline },
    { key: "REGIONS", label: dict.nav.regions },
    { key: "SOURCES", label: dict.nav.sources },
  ];

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 select-none">
      <div className="flex items-start justify-between gap-6 px-5 pt-4 md:px-7">
        <div className="boot min-w-0">
          <div className="flex items-baseline gap-3">
            <span className="text-[13px] font-extralight tracking-[0.5em] text-ice">ORBITAL</span>
            <span className="label-strong hidden translate-y-[-1px] sm:inline">{dict.system.subtitle}</span>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <span className="label">{dict.system.tagline}</span>
            <span className="hairline w-24" />
            <span className="readout">{dict.system.version}</span>
          </div>
        </div>

        <nav className="pointer-events-auto hidden items-center gap-5 md:flex">
          {navItems.map((item) => (
            <button
              key={item.key}
              className="nav-item"
              data-active={item.key === view}
              onClick={() => onView(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
          {/* Commutateur de langue FR / EN */}
          <div className="ml-2 flex items-center border border-cyan/30 bg-[#020b18]/80 p-[2px]">
            <button
              type="button"
              className={`px-2 py-0.5 text-[9px] font-mono tracking-wider transition-colors ${
                locale === "fr"
                  ? "bg-cyan/25 text-ice font-bold"
                  : "text-text-faint hover:text-text"
              }`}
              onClick={() => setLocale("fr")}
            >
              FR
            </button>
            <span className="text-[8px] text-cyan/30">|</span>
            <button
              type="button"
              className={`px-2 py-0.5 text-[9px] font-mono tracking-wider transition-colors ${
                locale === "en"
                  ? "bg-cyan/25 text-ice font-bold"
                  : "text-text-faint hover:text-text"
              }`}
              onClick={() => setLocale("en")}
            >
              EN
            </button>
          </div>
        </nav>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button type="button" className="chip pointer-events-auto" data-active={view === "SETUP"}
            aria-label={locale === "fr" ? "Ouvrir les paramètres" : "Open settings"}
            aria-expanded={view === "SETUP"} onClick={() => onView(view === "SETUP" ? "OVERVIEW" : "SETUP")}>
            {locale === "fr" ? "PARAMÈTRES" : "SETTINGS"}
          </button>
          <div className="flex items-center gap-2">
            <span
              className={`dot blink ${
                streamStatus === "open"
                  ? "text-cyan"
                  : streamStatus === "connecting"
                  ? "text-alert-soft"
                  : "text-alert"
              }`}
            />
            <span className="label">
              {streamStatus === "open"
                ? dict.system.streamActive
                : streamStatus === "connecting"
                ? dict.system.streamConnecting
                : dict.system.streamClosed}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`dot ${loading ? "text-alert-soft blink" : "text-cyan-dim"}`} />
            <span className="label">
              {loading ? dict.system.aggregating : dict.system.synced}
            </span>
          </div>
          <div className="readout text-right">
            {stats
              ? `${stats.totalInStore.toLocaleString(locale === "fr" ? "fr-FR" : "en-US")} ${dict.system.indexedEvents}`
              : "—"}
          </div>
        </div>
      </div>

      <div className="hairline mx-5 mt-3 md:mx-7" />
    </header>
  );
}
