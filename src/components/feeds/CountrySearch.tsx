"use client";

import { useMemo, useState } from "react";
import { normalizeCountryName } from "@/lib/geo/country";
import { tr } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import { countryLabel, useCountryReference } from "./countryReference";
import { flagEmoji } from "./feedModel";

/** Recherche de pays (référentiel Natural Earth) : ouvre la fiche pays unique et recentre le globe. */
export function CountrySearch() {
  const locale = useIntelStore((s) => s.locale);
  const setCountry = useIntelStore((s) => s.setCountry);
  const focus = useIntelStore((s) => s.focus);
  const { ref, status } = useCountryReference();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
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

  const choose = (index: number) => {
    const m = matches[index];
    if (!m?.c.center) return;
    setCountry({ name: m.c.name, iso: m.c.iso3, lat: m.c.center.lat, lon: m.c.center.lon, source: "explorer" });
    focus(m.c.center.lat, m.c.center.lon);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        type="search"
        className="search-input"
        value={query}
        placeholder={status === "error" ? tr(locale, "Référentiel pays indisponible", "Country reference unavailable") : tr(locale, "Rechercher un pays…", "Search a country…")}
        disabled={status === "error"}
        aria-label={tr(locale, "Rechercher un pays", "Search a country")}
        aria-expanded={open && matches.length > 0}
        aria-controls="country-search-results"
        role="combobox"
        aria-autocomplete="list"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(matches.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(active);
          }
        }}
      />
      {open && matches.length ? (
        <ul id="country-search-results" role="listbox" className="panel search-results">
          {matches.map(({ c, name }, i) => (
            <li key={c.iso3} role="option" aria-selected={i === active}>
              <button type="button" className="search-option" data-active={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i)}>
                <span aria-hidden>{flagEmoji(c.iso2) ?? "·"}</span>
                <span className="truncate">{name}</span>
                <span className="meta ml-auto">{c.iso3}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
