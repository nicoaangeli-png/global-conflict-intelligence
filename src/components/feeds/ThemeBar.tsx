"use client";

import { useMemo } from "react";
import { tr } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import { THEMES, THEME_COLORS, THEME_LABELS, inPeriod, itemsForTheme, label, type ThemeKey } from "./feedModel";
import { CountrySearch } from "./CountrySearch";
import { useNow } from "./useNow";

/**
 * Navigation par thèmes : chaque onglet filtre le FIL MONDIAL et n'allume
 * sur le globe que le calque correspondant. Le compteur = éléments datés
 * des dernières 24 h (zones signalées pour « Conflits »).
 */
export function ThemeBar() {
  const theme = useIntelStore((s) => s.theme);
  const setTheme = useIntelStore((s) => s.setTheme);
  const locale = useIntelStore((s) => s.locale);
  const feeds = useIntelStore((s) => s.feeds);
  const clusters = useIntelStore((s) => s.clusters);
  const now = useNow(60_000);

  const counts = useMemo(() => {
    const out: Partial<Record<ThemeKey, number>> = { all: 0 };
    for (const item of feeds) {
      if (!inPeriod(item, "24h", now)) continue;
      out[item.category] = (out[item.category] ?? 0) + 1;
    }
    out.all = itemsForTheme(feeds, "all", now).filter((item) => inPeriod(item, "24h", now)).length;
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
                  : tr(locale, `${count ?? 0} éléments datés des dernières 24 h`, `${count ?? 0} items dated within the last 24 h`)
              }
            >
              <span className="category-dot" style={{ background: THEME_COLORS[key] }} />
              {label(THEME_LABELS[key], locale)}
              {count ? <span className="theme-count">{count > 999 ? "999+" : count}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="theme-search">
        <CountrySearch />
      </div>
    </nav>
  );
}
