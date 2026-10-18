"use client";

import { useEffect, useState } from "react";
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

export type MobileDrawerKey = "globe" | "situation" | "conflict";

/**
 * En-tête : identité du système, navigation desktop & mobile, état du flux et sélecteur bilingue (FR/EN).
 * Le voyant de flux reflète réellement la connexion SSE.
 */
export function Header({
  view,
  onView,
  mobileDrawer,
  onMobileDrawer,
}: {
  view: ViewKey;
  onView: (v: ViewKey) => void;
  mobileDrawer?: MobileDrawerKey;
  onMobileDrawer?: (d: MobileDrawerKey) => void;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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

  // Fermer le menu mobile avec Échap
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileNavOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 select-none">
      <div className="flex items-start justify-between gap-4 px-4 pt-3 sm:gap-6 sm:px-5 sm:pt-4 md:px-7">
        <div className="boot min-w-0">
          <div className="flex items-baseline gap-2 sm:gap-3">
            <span className="text-[13px] font-extralight tracking-[0.5em] text-ice">ORBITAL</span>
            <span className="label-strong hidden translate-y-[-1px] sm:inline">{dict.system.subtitle}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 sm:gap-3">
            <span className="label truncate">{dict.system.tagline}</span>
            <span className="hairline hidden w-16 sm:inline-block sm:w-24" />
            <span className="readout hidden sm:inline">{dict.system.version}</span>
          </div>
        </div>

        {/* Navigation Desktop */}
        <nav className="pointer-events-auto hidden items-center gap-5 md:flex" aria-label="Navigation principale">
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
              aria-label="Passer l'interface en français"
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
              aria-label="Switch interface to English"
            >
              EN
            </button>
          </div>
        </nav>

        {/* Contrôles droits & Statut */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            {/* Bouton Menu Mobile */}
            <button
              type="button"
              className="chip pointer-events-auto md:hidden"
              data-active={mobileNavOpen}
              aria-label={
                mobileNavOpen
                  ? locale === "fr" ? "Fermer la navigation mobile" : "Close mobile navigation"
                  : locale === "fr" ? "Ouvrir la navigation mobile" : "Open mobile navigation"
              }
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-navigation-drawer"
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              {mobileNavOpen ? (locale === "fr" ? "FERMER" : "CLOSE") : "NAV"}
            </button>

            {/* Bouton Paramètres accessible */}
            <button
              id="settings-trigger-button"
              type="button"
              className="chip pointer-events-auto"
              data-active={view === "SETUP"}
              aria-label={
                view === "SETUP"
                  ? locale === "fr" ? "Fermer les paramètres" : "Close settings"
                  : locale === "fr" ? "Ouvrir les paramètres" : "Open settings"
              }
              aria-expanded={view === "SETUP"}
              aria-haspopup="dialog"
              aria-controls="settings-dialog"
              onClick={() => onView(view === "SETUP" ? "OVERVIEW" : "SETUP")}
            >
              {locale === "fr" ? "PARAMÈTRES" : "SETTINGS"}
            </button>
          </div>

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

      <div className="hairline mx-4 mt-2 sm:mx-5 sm:mt-3 md:mx-7" />

      {/* Tiroir de navigation mobile */}
      {mobileNavOpen ? (
        <nav
          id="mobile-navigation-drawer"
          role="navigation"
          aria-label={locale === "fr" ? "Navigation mobile" : "Mobile navigation"}
          className="panel corners boot pointer-events-auto mx-4 mt-2 flex flex-col gap-2.5 p-3 md:hidden z-30 shadow-2xl"
        >
          <span className="corner" />
          <div className="flex items-center justify-between border-b border-cyan/20 pb-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-ice">
              {locale === "fr" ? "Vues & Navigation" : "Views & Navigation"}
            </span>
            {/* Langue FR / EN */}
            <div className="flex items-center border border-cyan/30 bg-[#020b18]/80 p-[2px]">
              <button
                type="button"
                className={`px-2 py-0.5 text-[9px] font-mono tracking-wider transition-colors ${
                  locale === "fr" ? "bg-cyan/25 text-ice font-bold" : "text-text-faint hover:text-text"
                }`}
                onClick={() => setLocale("fr")}
              >
                FR
              </button>
              <span className="text-[8px] text-cyan/30">|</span>
              <button
                type="button"
                className={`px-2 py-0.5 text-[9px] font-mono tracking-wider transition-colors ${
                  locale === "en" ? "bg-cyan/25 text-ice font-bold" : "text-text-faint hover:text-text"
                }`}
                onClick={() => setLocale("en")}
              >
                EN
              </button>
            </div>
          </div>

          {/* Grille de liens de vues */}
          <div className="grid grid-cols-2 gap-1.5">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`px-2.5 py-1.5 text-left text-[10px] font-mono transition-colors border ${
                  item.key === view
                    ? "border-cyan bg-cyan/20 text-ice font-bold"
                    : "border-cyan/15 bg-[#020b18]/60 text-text-dim hover:text-text"
                }`}
                onClick={() => {
                  onView(item.key);
                  setMobileNavOpen(false);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Accès rapide aux panneaux sur mobile */}
          {onMobileDrawer && (
            <div className="border-t border-cyan/20 pt-2">
              <div className="mb-1 text-[9px] font-mono uppercase text-text-faint">
                {locale === "fr" ? "Tiroir actif (mobile) :" : "Active panel (mobile):"}
              </div>
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  className={`px-1 py-1 text-center text-[9px] font-mono border transition-colors ${
                    mobileDrawer === "globe"
                      ? "border-cyan bg-cyan/25 text-ice font-bold"
                      : "border-cyan/15 bg-[#020b18]/60 text-text-dim hover:text-text"
                  }`}
                  onClick={() => {
                    onMobileDrawer("globe");
                    setMobileNavOpen(false);
                  }}
                >
                  🌐 GLOBE
                </button>
                <button
                  type="button"
                  className={`px-1 py-1 text-center text-[9px] font-mono border transition-colors ${
                    mobileDrawer === "situation"
                      ? "border-cyan bg-cyan/25 text-ice font-bold"
                      : "border-cyan/15 bg-[#020b18]/60 text-text-dim hover:text-text"
                  }`}
                  onClick={() => {
                    onMobileDrawer("situation");
                    setMobileNavOpen(false);
                  }}
                >
                  📊 {locale === "fr" ? "SITUATION" : "OVERVIEW"}
                </button>
                <button
                  type="button"
                  className={`px-1 py-1 text-center text-[9px] font-mono border transition-colors ${
                    mobileDrawer === "conflict"
                      ? "border-cyan bg-cyan/25 text-ice font-bold"
                      : "border-cyan/15 bg-[#020b18]/60 text-text-dim hover:text-text"
                  }`}
                  onClick={() => {
                    onMobileDrawer("conflict");
                    setMobileNavOpen(false);
                  }}
                >
                  ⚡ {locale === "fr" ? "CONFLITS" : "FEED"}
                </button>
              </div>
            </div>
          )}
        </nav>
      ) : null}
    </header>
  );
}
