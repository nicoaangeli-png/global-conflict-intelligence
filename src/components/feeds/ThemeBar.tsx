"use client";

import { useMemo } from "react";
import { tr } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import { THEMES, THEME_COLORS, THEME_TAB_LABELS, inPeriod, itemsForTheme, label, type ThemeKey } from "./feedModel";
import { useNow } from "./useNow";

/**
 * Navigation par thèmes : chaque onglet filtre le FIL MONDIAL et n'allume
 * sur le globe que le calque correspondant. Le compteur = éléments datés
 * des dernières 24 h (zones signalées pour « Conflits »). La recherche de pays
 * est dans l'en-tête : la barre reste entièrement aux onglets.
 */
export function ThemeBar() {
  const theme = useIntelStore((s) => s.theme);
  const setTheme = useIntelStore((s) => s.setTheme);
  const locale = useIntelStore((s) => s.locale);
  const feeds = useIntelStore((s) => s.feeds);
  const clusters = useIntelStore((s) => s.clusters);
  const now = useNow(60_000);

  const counts = useMemo(() => {
    const out: Partial<Record<ThemeKey, number>> = {};
    for (const key of THEMES) {
      if (key === "conflict") continue;
      out[key] = itemsForTheme(feeds, key, now).filter((item) => inPeriod(item, "24h", now)).length;
    }
    out.conflict = clusters.length;
    return out;
  }, [feeds, clusters, now]);

  return (
    <nav className="theme-bar" aria-label={tr(locale, "Thèmes du fil mondial", "World feed themes")}>
      <div className="theme-tabs" role="tablist">
        {THEMES.map((key) => {
          const active = theme === key;
          const count = counts[key];
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              className="theme-tab"
              data-active={active}
              onClick={() => setTheme(key)}
              title={
                key === "conflict"
                  ? tr(locale, `${count ?? 0} zones signalées sur la période choisie`, `${count ?? 0} reported areas over the chosen period`)
                  : key === "military"
                    ? tr(locale, `${count ?? 0} aéronefs militaires dont la position ADS-B est publiée (24 h)`, `${count ?? 0} military aircraft with a published ADS-B position (24 h)`)
                    : tr(locale, `${count ?? 0} éléments datés des dernières 24 h`, `${count ?? 0} items dated within the last 24 h`)
              }
            >
              <span className="category-dot" style={{ background: THEME_COLORS[key] }} />
              {label(THEME_TAB_LABELS[key], locale)}
              {count ? <span className="theme-count">{count > 999 ? "999+" : count}</span> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
