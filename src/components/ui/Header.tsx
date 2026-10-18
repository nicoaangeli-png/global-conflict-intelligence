"use client";

import { useEffect, useState } from "react";
import { useIntelStore } from "@/store/useIntelStore";
import { t, tr } from "@/lib/i18n";
import { SourcesButton } from "@/components/feeds/SourcesPopover";

/**
 * En-tête sur une seule ligne : identité, horloge UTC, état réel du direct
 * (connexion SSE), sources, bilan du jour (pas encore disponible), réglages, langue.
 * Aucune mention de provenance en bandeau : tout passe par « Sources ».
 */

function UtcClock({ locale }: { locale: "fr" | "en" }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const date = now.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
  const time = now.toLocaleTimeString("fr-FR", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <time className="utc-clock" dateTime={now.toISOString()} aria-label={tr(locale, "Heure UTC", "UTC time")}>
      {date} · {time} UTC
    </time>
  );
}

export function Header({
  settingsOpen,
  onSettings,
  onBriefing,
}: {
  settingsOpen: boolean;
  onSettings: () => void;
  /**
   * Point de branchement du « Bilan du jour » (GET /api/briefing) : tant qu'il
   * n'est pas fourni, le bouton reste désactivé avec l'info-bulle « bientôt ».
   */
  onBriefing?: () => void;
}) {
  const streamStatus = useIntelStore((s) => s.streamStatus);
  const locale = useIntelStore((s) => s.locale);
  const setLocale = useIntelStore((s) => s.setLocale);
  const dict = t(locale).system;
  const streamTone = streamStatus === "open" ? "ok" : streamStatus === "connecting" ? "warn" : "error";

  return (
    <header className="app-header">
      <div className="flex min-w-0 items-baseline gap-4">
        <span className="brand">ORBITAL</span>
        <span className="brand-tagline">{dict.tagline}</span>
        <UtcClock locale={locale} />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="stream-state" data-tone={streamTone} title={dict.streamHint} role="status">
          <span className="status-dot" data-tone={streamTone} />
          {streamStatus === "open" ? dict.streamOpen : streamStatus === "connecting" ? dict.streamConnecting : dict.streamClosed}
        </span>
        <SourcesButton />
        {onBriefing ? (
          <button type="button" className="header-button" onClick={onBriefing}>
            🎙️ {dict.briefing}
          </button>
        ) : (
          // Bilan non branché : bouton désactivé, aucun contenu inventé.
          <span className="tooltip-host" tabIndex={0} aria-label={`${dict.briefing} — ${dict.briefingSoon}`}>
            <button type="button" className="header-button" disabled aria-disabled="true">
              🎙️ {dict.briefing}
            </button>
            <span className="tooltip" role="tooltip">
              {dict.briefingSoon}
            </span>
          </span>
        )}
        <button
          id="settings-trigger-button"
          type="button"
          className="header-button"
          data-active={settingsOpen}
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          aria-controls="settings-dialog"
          onClick={onSettings}
          title={dict.settings}
        >
          ⚙<span className="sr-only">{dict.settings}</span>
        </button>
        <div className="lang-switch" role="group" aria-label={tr(locale, "Langue", "Language")}>
          {(["fr", "en"] as const).map((l) => (
            <button key={l} type="button" data-active={locale === l} aria-pressed={locale === l} onClick={() => setLocale(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
