"use client";

import { CONFLICT } from "@/lib/config/visual";
import { compact, dateTimeUTC, int, relative } from "@/lib/format";
import { useIntelStore } from "@/store/useIntelStore";
import { t } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { getCountryGeopolitics, normalizeCountry } from "@/data/geopolitics";
import { CountryProfile } from "./CountryProfile";
import { canonicalCountryIdentity, normalizeCountryName, resolveCountryIdentity } from "@/lib/geo/country";
import { countryInteriorPoint } from "@/lib/geo/world";

/**
 * Panneau « GLOBAL SITUATION ».
 * Toutes les valeurs proviennent de l'agrégat serveur.
 * Traduction automatique selon la langue sélectionnée (FR/EN).
 */

function Sparkline({ data, accent }: { data: { events: number; fatalities: number }[]; accent?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.events));
  return (
    <div className="tick-marks flex h-10 items-end gap-[2px] border-b border-[rgba(127,212,255,0.12)] pb-[1px]">
      {data.map((d, i) => {
        const h = Math.max(2, (d.events / max) * 34);
        const hot = d.fatalities > 0;
        return (
          <div
            key={i}
            title={`${d.events} événement(s)`}
            className="flex-1"
            style={{
              height: `${h}px`,
              background: hot
                ? accent
                  ? "linear-gradient(180deg, rgba(255,138,61,0.9), rgba(255,74,47,0.25))"
                  : "linear-gradient(180deg, rgba(255,74,47,0.75), rgba(255,74,47,0.18))"
                : "linear-gradient(180deg, rgba(127,212,255,0.5), rgba(127,212,255,0.1))",
            }}
          />
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  hint,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  accent?: "alert" | "cyan";
}) {
  return (
    <div className="flex items-baseline justify-between py-[7px]">
      <div className="flex flex-col">
        <span className="label">{label}</span>
        {hint ? <span className="readout mt-[2px] text-[9px] text-text-faint">{hint}</span> : null}
      </div>
      <div className="flex items-baseline gap-1">
        <span
          className="value text-[19px] font-light leading-none"
          style={{
            color: accent === "alert" ? "#ff9a80" : undefined,
          }}
        >
          {value}
        </span>
        {unit ? <span className="label-strong text-[8px]">{unit}</span> : null}
      </div>
    </div>
  );
}

type CountryEntry = { name: string; iso: string; center: { lat: number; lon: number } | null };
type CountryRanking = { country: string; eventCount: number; fatalities: number; intensity: number; mediaSignals: number };

function countryKey(name: string, reference: CountryEntry[] = []) {
  const resolved = resolveCountryIdentity(name)?.iso3;
  if (resolved) return resolved;
  const normalized = normalizeCountryName(name);
  const match = reference.find((country) => country.iso === name.toUpperCase() || normalizeCountryName(country.name) === normalized);
  return match?.iso ?? normalized;
}

function CountryRow({ country, index, onSelect }: { country: CountryRanking; index: number; onSelect: () => void }) {
  const locale = useIntelStore((state) => state.locale);

  return (
    <button
      type="button"
      className="row-button group flex items-center gap-2"
      onClick={onSelect}
    >
      <span className="readout w-4 shrink-0 text-[9px] text-text-faint">{String(index + 1).padStart(2, "0")}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-[11px] font-light tracking-wide text-text">{country.country}</span>
        </span>
        <span className="mt-[3px] flex items-center gap-2">
          <span className="h-[2px] flex-1 bg-[rgba(127,212,255,0.08)]">
            <span
              className="block h-full"
              style={{
                width: `${Math.round(country.intensity * 100)}%`,
                background: `linear-gradient(90deg, ${CONFLICT.markerBarFrom}, ${CONFLICT.markerBarTo})`,
                boxShadow: "0 0 8px -1px rgba(255,74,47,0.7)",
              }}
            />
          </span>
          <span className="readout text-[9px] text-text-faint">
            {country.eventCount}
            {country.fatalities > 0 ? ` · ${compact(country.fatalities)}†` : ""}
          </span>
        </span>
      </span>
      {country.mediaSignals > 0 ? <span className="text-[8px] text-text-faint">{country.mediaSignals} {locale === "fr" ? "presse" : "media"}</span> : null}
    </button>
  );
}

export function GlobalSituationPanel() {
  const stats = useIntelStore((s) => s.stats);
  const clusters = useIntelStore((s) => s.clusters);
  const at = useIntelStore((s) => s.filters.at);
  const locale = useIntelStore((s) => s.locale);
  const focus = useIntelStore((s) => s.focus);
  const countrySelection = useIntelStore((s) => s.country);
  const setCountry = useIntelStore((s) => s.setCountry);
  const [countries, setCountries] = useState<CountryEntry[]>([]);
  const [referenceStatus, setReferenceStatus] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [persistenceFailed, setPersistenceFailed] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/ne_110m_countries.geojson", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Country reference unavailable");
        return response.json();
      })
      .then((data: { features: { properties: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }[] }) => {
        const entries = data.features.flatMap(({ properties, geometry }) => {
          const sourceName = properties.ADMIN || properties.NAME;
          if (typeof sourceName !== "string") return [];
          const identity = canonicalCountryIdentity(sourceName, { isoA3: properties.ISO_A3, adm0A3: properties.ADM0_A3, sovA3: properties.SOV_A3 });
          const iso = identity?.iso3 ?? "";
          return iso ? [{ name: identity?.name ?? sourceName, iso, center: countryInteriorPoint(geometry) }] : [];
        });
        setCountries(entries);
        setReferenceStatus("ready");
      })
      .catch(() => { if (!controller.signal.aborted) setReferenceStatus("error"); });
    try {
      const stored: unknown = JSON.parse(localStorage.getItem("orbital.country-favorites.v1") || "[]");
      if (Array.isArray(stored)) setFavorites(stored.filter((value): value is string => typeof value === "string"));
    } catch { setPersistenceFailed(true); }
    setFavoritesReady(true);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!favoritesReady) return;
    try {
      localStorage.setItem("orbital.country-favorites.v1", JSON.stringify(favorites));
    } catch { setPersistenceFailed(true); }
  }, [favorites, favoritesReady]);

  const ranking = useMemo(() => {
    const grouped = new Map<string, CountryRanking>();
    for (const cluster of clusters) {
      if (!cluster.country.trim()) continue;
      const key = countryKey(cluster.country, countries);
      const country = grouped.get(key) ?? { country: cluster.country, eventCount: 0, fatalities: 0, intensity: 0, mediaSignals: 0 };
      country.eventCount += cluster.eventCount;
      country.fatalities += cluster.fatalities;
      country.intensity = Math.max(country.intensity, cluster.intensity);
      country.mediaSignals += cluster.confidenceCounts.MEDIA_SIGNAL ?? 0;
      grouped.set(key, country);
    }
    return [...grouped.values()].sort((first, second) => second.eventCount - first.eventCount || first.country.localeCompare(second.country));
  }, [clusters, countries]);
  const matchingCountries = countries.filter((country) => {
    const profile = getCountryGeopolitics(country.name);
    const queryKey = resolveCountryIdentity(query)?.iso3 ?? normalizeCountry(query);
    return (!favoritesOnly || favorites.includes(country.iso)) && (!query || country.iso.includes(query.toUpperCase()) || [country.name, country.iso, profile.country].some((value) => normalizeCountryName(value).includes(normalizeCountryName(query))) || country.iso === queryKey);
  }).sort((first, second) => Number(favorites.includes(second.iso)) - Number(favorites.includes(first.iso)) || first.name.localeCompare(second.name, locale));

  const dict = t(locale);
  const daily = stats?.daily ?? [];
  const top = ranking.slice(0, 6);

  /** Ouvre la fiche et recentre le globe (référentiel pays, sinon foyer le plus intense). */
  const chooseCountry = (name: string) => {
    const entry = countries.find((country) => countryKey(country.name, countries) === countryKey(name, countries));
    const center = entry?.center;
    const hottest = clusters
      .filter((cluster) => countryKey(cluster.country, countries) === countryKey(name, countries))
      .sort((first, second) => second.intensity - first.intensity)[0];
    const target = center ?? (hottest ? { lat: hottest.latitude, lon: hottest.longitude } : null);
    if (entry && target) {
      setCountry({ name: entry.name, iso: entry.iso, lat: target.lat, lon: target.lon, source: "explorer" });
      focus(target.lat, target.lon);
    }
  };
  const major = clusters.filter((c) => c.intensity >= 0.5).length;

  return (
    <section className="panel corners boot w-[268px]">
      <span className="corner" />
      <div className="sweep" />
      <div className="flex items-center justify-between px-3 pt-[10px]">
        <span className="label-strong">{dict.globalSituation.title}</span>
        <span className="readout text-[9px]">
          {at ? (locale === "fr" ? "ARCHIVE" : "HISTORICAL") : (locale === "fr" ? "TEMPS RÉEL" : "REAL-TIME")}
        </span>
      </div>
      <div className="hairline mx-3 mt-2" />

      <div className="px-3 pt-1">
        <Stat
          label={dict.globalSituation.activeHotspots}
          value={int(stats?.activeZones)}
          hint={locale === "fr" ? `dont ${major} théâtres majeurs` : `incl. ${major} major theaters`}
          accent="alert"
        />
        <div className="hairline" />
        <Stat
          label={locale === "fr" ? "Enregistrements (24 h)" : "Records (24 h)"}
          value={int(stats?.periodCounts?.absolute.events24h)}
          hint={locale === "fr" ? "mêmes filtres · fenêtre absolue" : "same filters · absolute window"}
        />
        <div className="hairline" />
        <Stat
          label={locale === "fr" ? "Enregistrements (7 jours)" : "Records (7 days)"}
          value={int(stats?.periodCounts?.absolute.events7d)}
          hint={locale === "fr" ? "mêmes filtres · fenêtre absolue" : "same filters · absolute window"}
        />
        <div className="hairline" />
        <Stat
          label={dict.globalSituation.fatalitiesWindow}
          value={stats?.coverage && stats.coverage.documented + stats.coverage.demo === 0 ? "N/A" : compact(stats?.fatalitiesRange)}
          unit="†"
          hint={locale === "fr" ? "cumul renseigné · morts inconnus pour la presse" : "reported total · media fatalities unknown"}
          accent="alert"
        />
        <div className="hairline" />
        <div className="flex items-baseline justify-between py-[7px]">
          <span className="label">{dict.globalSituation.temporalCurve}</span>
          <span className="readout text-[9px]">{gridLabel(stats?.range, locale)}</span>
        </div>
        <Sparkline data={daily} />
        <div className="mt-[6px] flex items-center justify-between">
          <span className="readout text-[9px]">{daily.length ? daily[0].day.replace("T", " ").slice(0, stats?.range === "24h" ? 16 : 10) : "—"}</span>
          <span className="readout text-[9px]">{daily.length ? daily[daily.length - 1].day.replace("T", " ").slice(0, stats?.range === "24h" ? 16 : 10) : "—"}</span>
        </div>
      </div>

      <div className="hairline mx-3 mt-3" />
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="label-strong">{locale === "fr" ? "Pays · Top 6" : "Countries · Top 6"}</span>
        <span className="readout text-[9px]">{locale === "fr" ? "événements" : "events"}</span>
      </div>
      <p className="px-3 pt-1 text-[9px] text-text-faint">{locale === "fr" ? "Période et filtres actifs · Presse = mentions, pas incidents vérifiés · Barre = intensité max. des foyers" : "Active period and filters · Media are mentions, not verified incidents · Bar = max. cluster intensity"}</p>
      <div className="max-h-[228px] overflow-y-auto py-1 scroll-thin">
        {top.length ? (
          top.map((country, index) => <CountryRow key={countryKey(country.country)} country={country} index={index} onSelect={() => chooseCountry(country.country)} />)
        ) : (
          <div className="px-3 py-4 text-[10px] text-text-faint">
            {locale === "fr" ? "aucun foyer sur la période" : "no clusters in this period"}
          </div>
        )}
      </div>

      <div className="hairline mx-3" />
      <div className="space-y-2 px-3 py-2">
        <label htmlFor="country-explorer" className="label-strong block">{locale === "fr" ? "Explorer les pays" : "Explore countries"}</label>
        <input id="country-explorer" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={locale === "fr" ? "Nom ou ISO · ex. Iran" : "Name or ISO · e.g. Iran"} className="w-full border border-cyan/20 bg-[#020b14] px-2 py-1.5 text-[11px] text-text focus:border-cyan focus:outline-none" />
        <button type="button" className="chip" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(!favoritesOnly)}>{locale === "fr" ? "Favoris uniquement" : "Favorites only"} ({favorites.length})</button>
        <p className="text-[9px] text-text-faint">{locale === "fr" ? "Référentiel Natural Earth 110m, indépendant des événements. Couverture non exhaustive des petits États." : "Natural Earth 110m reference, independent of events. Small-state coverage is not exhaustive."}</p>
        {persistenceFailed && <p role="status" className="text-[9px] text-alert-soft">{locale === "fr" ? "Stockage local indisponible : favoris temporaires." : "Local storage unavailable: temporary favorites."}</p>}
      </div>
      <div className="scroll-thin max-h-[180px] overflow-y-auto" aria-live="polite">
        {referenceStatus !== "ready" ? <p role="status" className="px-3 py-2 text-[10px] text-text-faint">{referenceStatus === "loading" ? (locale === "fr" ? "Chargement du référentiel…" : "Loading reference…") : (locale === "fr" ? "Référentiel indisponible." : "Reference unavailable.")}</p> : matchingCountries.length ? matchingCountries.map((country) => {
          const activity = ranking.find((entry) => countryKey(entry.country, countries) === countryKey(country.name, countries));
          return (
            <div key={country.iso} className="flex items-center gap-1 px-3">
              <button type="button" className="row-button min-w-0 flex-1 text-left" aria-expanded={countrySelection?.iso === country.iso} onClick={() => chooseCountry(country.name)}>
                <span className="block truncate text-[11px] text-text">{country.name}</span>
                <span className="text-[9px] text-text-faint">{country.iso} · {activity ? `${activity.eventCount} ${locale === "fr" ? "événements" : "events"}` : locale === "fr" ? "Aucun événement dans la sélection" : "No events in current selection"}</span>
              </button>
              <button type="button" className="chip shrink-0" aria-label={`${locale === "fr" ? "Favori" : "Favorite"}: ${country.name}`} aria-pressed={favorites.includes(country.iso)} onClick={() => setFavorites((previous) => previous.includes(country.iso) ? previous.filter((iso) => iso !== country.iso) : [...previous, country.iso])}>{favorites.includes(country.iso) ? "★" : "☆"}</button>
            </div>
          );
        }) : <p className="px-3 py-2 text-[10px] text-text-faint">{locale === "fr" ? "Aucun pays correspondant." : "No matching countries."}</p>}
      </div>
      {countrySelection?.source === "explorer" && <><div className="flex justify-end px-3 py-1"><button type="button" className="chip" onClick={() => setCountry(null)}>{locale === "fr" ? "Fermer la fiche" : "Close profile"}</button></div><CountryProfile country={countrySelection.name} iso={countrySelection.iso} locale={locale} /></>}

      <div className="hairline mx-3" />
      <div className="flex items-center justify-between px-3 py-2">
        <span className="label">{locale === "fr" ? "Dernière mise à jour" : "Latest sync"}</span>
        <span className="readout text-[9px]" title={dateTimeUTC(stats?.lastDataUpdate)}>
          {relative(stats?.lastDataUpdate)}
        </span>
      </div>
    </section>
  );
}

function gridLabel(range: string | undefined, locale: "fr" | "en") {
  if (range === "24h") return locale === "fr" ? "HORAIRE" : "HOURLY";
  if (range === "1y" || range === "6m") return locale === "fr" ? "HEBDO" : "WEEKLY";
  return locale === "fr" ? "JOURNALIER" : "DAILY";
}
