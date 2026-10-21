"use client";

import { useId, useMemo, useRef, useState } from "react";
import { normalizeCountryName } from "@/lib/geo/country";
import { tr } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import { countryLabel, useCountryReference } from "./countryReference";
import { flagEmoji } from "./feedModel";

/** Recherche de pays (référentiel Natural Earth) : ouvre la fiche pays unique et recentre le globe. */
export function CountrySearch({ embedded = false, onSelect }: { embedded?: boolean; onSelect?: () => void }) {
  const searchId = useId();
  const resultsId = `${searchId}-results`;
  const inputRef = useRef<HTMLInputElement>(null);
  const locale = useIntelStore((s) => s.locale);
  const setCountry = useIntelStore((s) => s.setCountry);
  const focus = useIntelStore((s) => s.focus);
  const { ref, status } = useCountryReference();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(embedded);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const q = normalizeCountryName(query);
    if (!ref || !q) return [];
    return [...ref.values()]
      .map((c) => ({ c, name: countryLabel(c.iso3, ref, locale) }))
      .filter(({ c, name }) => c.center && (normalizeCountryName(name).includes(q) || normalizeCountryName(c.name).includes(q) || c.iso3.toLowerCase() === q))
      .sort((a, b) => Number(!normalizeCountryName(a.name).startsWith(q)) - Number(!normalizeCountryName(b.name).startsWith(q)) || a.name.localeCompare(b.name, locale))
      .slice(0, 8);
  }, [query, ref, locale]);
  const showingResults = open && matches.length > 0;

  const choose = (index: number) => {
    const m = matches[index];
    if (!m?.c.center) return;
    setCountry({ name: m.c.name, iso: m.c.iso3, lat: m.c.center.lat, lon: m.c.center.lon, source: "explorer" });
    focus(m.c.center.lat, m.c.center.lon);
    setQuery("");
    setOpen(false);
    setActive(0);
    onSelect?.();
  };

  return (
    <div
      className={embedded ? "mobile-country-search" : "relative"}
      onBlur={(event) => {
        if (!embedded && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <div className={embedded ? "mobile-country-search-controls flex items-center gap-2" : "relative"}>
        <input
          ref={inputRef}
          id={searchId}
          type="search"
          className="search-input"
          style={embedded ? { minHeight: 48, fontSize: 16, width: "100%", minWidth: 0 } : undefined}
          value={query}
          placeholder={status === "error" ? tr(locale, "Référentiel pays indisponible", "Country reference unavailable") : tr(locale, "Rechercher un pays…", "Search a country…")}
          disabled={status === "error"}
          aria-label={tr(locale, "Rechercher un pays", "Search a country")}
          aria-expanded={showingResults}
          aria-controls={showingResults ? resultsId : undefined}
          aria-activedescendant={showingResults ? `${searchId}-option-${Math.min(active, matches.length - 1)}` : undefined}
          role="combobox"
          aria-autocomplete="list"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => showingResults ? Math.max(0, Math.min(matches.length - 1, i + 1)) : 0);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter" && showingResults) {
              e.preventDefault();
              choose(Math.min(active, matches.length - 1));
            }
          }}
        />
        {embedded ? (
          <button
            type="button"
            className="chip mobile-country-search-close"
            style={{ minHeight: 48, minWidth: 48 }}
            aria-label={tr(locale, "Fermer les résultats", "Close results")}
            onClick={() => {
              inputRef.current?.focus();
              setOpen(false);
            }}
          >
            ✕
          </button>
        ) : null}
      </div>
      {showingResults ? (
        <ul id={resultsId} role="listbox" aria-label={tr(locale, "Pays", "Countries")} className={embedded ? "panel mobile-country-search-results" : "panel search-results"}>
          {matches.map(({ c, name }, i) => (
            <li key={c.iso3} id={`${searchId}-option-${i}`} role="option" aria-selected={i === active}>
              <button type="button" className="search-option" style={embedded ? { minHeight: 48, fontSize: 16 } : undefined} data-active={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i)}>
                <span aria-hidden>{flagEmoji(c.iso2) ?? "·"}</span>
                <span className="truncate">{name}</span>
                <span className="meta ml-auto">{c.iso3}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : open && query.trim() ? (
        <p className="meta" role="status">
          {status === "loading" ? tr(locale, "Chargement…", "Loading…") : status === "error" ? tr(locale, "Référentiel pays indisponible", "Country reference unavailable") : tr(locale, "Aucun pays trouvé.", "No countries found.")}
        </p>
      ) : null}
    </div>
  );
}
