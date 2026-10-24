"use client";

import { useEffect, useMemo, useState } from "react";
import { absoluteDateTime, relativeTime } from "@/lib/format";
import { tr, type Locale } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import type { LiveItem } from "@/types/feeds";
import { FeedItemRow } from "./FeedItem";
import { SourcesButton } from "./SourcesPopover";
import { vehicleOf, type VehicleKind } from "./vehicleModel";
import { ConflictsPanel } from "./ConflictsPanel";
import {
  PERIODS,
  THEME_COLORS,
  defaultPeriod,
  THEME_CATEGORIES,
  THEME_LABELS,
  THEME_TAB_LABELS,
  failingSourcesFor,
  inPeriod,
  isFuture,
  itemsForTheme,
  label,
  sortChronological,
  themeCovers,
  type PeriodKey,
  type ThemeKey,
} from "./feedModel";
import { useNow } from "./useNow";

/**
 * Panneau « FIL MONDIAL » : liste chronologique des éléments du thème actif,
 * avec une synthèse discrète des sources et un état vide honnête.
 */

const THEME_SUBTITLES: Partial<Record<ThemeKey, { fr: string; en: string }>> = {
  all: { fr: "Actualité de tous les flux, du plus récent au plus ancien", en: "News from all feeds, newest first" },
  military: { fr: "Avions (ADS-B) et navires (AIS) militaires dont la position est publiée — rafraîchi toutes les 30 s", en: "Military aircraft (ADS-B) and vessels (AIS) with a published position — refreshed every 30 s" },
  infrastructure: { fr: "Pannes d'internet (IODA) et perturbations des ports et détroits (FMI PortWatch)", en: "Internet outages (IODA) and port and strait disruptions (IMF PortWatch)" },
  social: { fr: "Manifestations, émeutes, grèves — signaux presse", en: "Protests, riots, strikes — press signals" },
  disaster: { fr: "Séismes, cyclones, inondations, feux et alertes météo officielles", en: "Earthquakes, cyclones, floods, fires and official weather alerts" },
  health: { fr: "Épidémies — bulletins officiels", en: "Outbreaks — official bulletins" },
  un: { fr: "Actualités et communiqués de l'ONU", en: "UN news and press releases" },
  space: { fr: "Lancements spatiaux — passés et planifiés", en: "Space launches — past and scheduled" },
  nuclear: { fr: "Nucléaire civil et militaire — presse spécialisée", en: "Civil and military nuclear — trade press" },
  economy: { fr: "Indices boursiers et devises — cotations", en: "Stock indices and currencies — quotes" },
  uap: { fr: "Dossiers OVNI / PAN — rapports officiels publiés", en: "UAP files — published official reports" },
};

const MAX_ROWS = 200;

/**
 * Avertissements répétés à l'identique par une source (ADS-B, IODA, OMM…) :
 * affichés une fois en tête du fil plutôt que sous chaque ligne.
 */
function sharedCaveats(items: LiveItem[]): { sourceName: string; caveat: string }[] {
  const counts = new Map<string, { sourceName: string; caveat: string; n: number }>();
  for (const item of items) {
    if (!item.caveat) continue;
    const key = `${item.sourceId}\u0000${item.caveat}`;
    const entry = counts.get(key) ?? { sourceName: item.sourceName, caveat: item.caveat, n: 0 };
    entry.n++;
    counts.set(key, entry);
  }
  return [...counts.values()].filter((e) => e.n >= 3).map(({ sourceName, caveat }) => ({ sourceName, caveat }));
}

function UapNotice({ locale }: { locale: Locale }) {
  return (
    <div className="mx-4 mt-3 space-y-2">
      <p className="warning-banner" role="note">
        {tr(
          locale,
          "Rapports et témoignages publiés par des organismes officiels — ne constituent pas des faits établis.",
          "Reports and testimonies published by official bodies — not established facts.",
        )}
      </p>
      <details className="info-box">
        <summary>{tr(locale, "Classification GEIPAN (CNES) : A, B, C, D", "GEIPAN (CNES) classification: A, B, C, D")}</summary>
        <dl className="kv mt-2">
          <dt>A</dt>
          <dd>{tr(locale, "Phénomène identifié avec certitude", "Phenomenon identified with certainty")}</dd>
          <dt>B</dt>
          <dd>{tr(locale, "Phénomène probablement identifié", "Phenomenon probably identified")}</dd>
          <dt>C</dt>
          <dd>{tr(locale, "Non identifiable faute de données fiables", "Unidentifiable for lack of reliable data")}</dd>
          <dt>D</dt>
          <dd>{tr(locale, "Non identifié après enquête — n'établit aucune origine extraterrestre", "Unidentified after investigation — establishes no extraterrestrial origin")}</dd>
        </dl>
        <p className="meta mt-2">
          {tr(
            locale,
            "AARO (Pentagone, États-Unis) publie ses rapports sur aaro.mil ; son état de collecte figure dans « Sources ».",
            "AARO (Pentagon, USA) publishes its reports on aaro.mil; its collection status appears in “Sources”.",
          )}
        </p>
      </details>
    </div>
  );
}

export function WorldFeedPanel() {
  const theme = useIntelStore((s) => s.theme);
  const locale = useIntelStore((s) => s.locale);
  const feeds = useIntelStore((s) => s.feeds);
  const feedSources = useIntelStore((s) => s.feedSources);
  const feedsStatus = useIntelStore((s) => s.feedsStatus);
  const feedFailures = useIntelStore((s) => s.feedFailures);
  const feedsCheckedAt = useIntelStore((s) => s.feedsCheckedAt);
  const refreshFeeds = useIntelStore((s) => s.refreshFeeds);
  const weatherAll = useIntelStore((s) => s.weatherAll);
  const setWeatherAll = useIntelStore((s) => s.setWeatherAll);
  const refreshConflicts = useIntelStore((s) => s.refresh);
  const conflictsLoading = useIntelStore((s) => s.loading);
  const lastSync = useIntelStore((s) => s.lastSync);
  const now = useNow();
  // Période par défaut adaptée au rythme de publication du thème (voir `defaultPeriod`).
  const [period, setPeriod] = useState<PeriodKey>(() => defaultPeriod(theme));
  useEffect(() => {
    setPeriod(defaultPeriod(theme));
  }, [theme]);

  // Onglet Militaire : avions et navires distingués (filtre local au fil).
  const [vehicleFilter, setVehicleFilter] = useState<VehicleKind | "all">("all");
  const themedAll = useMemo(() => itemsForTheme(feeds, theme, now, { allWeather: weatherAll }), [feeds, theme, now, weatherAll]);
  const vehicleCounts = useMemo(() => {
    if (theme !== "military") return null;
    const out = { aircraft: 0, vessel: 0, merchant: 0 };
    for (const item of themedAll) {
      const kind = vehicleOf(item);
      if (kind) out[kind]++;
    }
    return out;
  }, [themedAll, theme]);
  const themed = useMemo(
    () => (theme === "military" && vehicleFilter !== "all" ? themedAll.filter((item) => vehicleOf(item) === vehicleFilter) : themedAll),
    [themedAll, theme, vehicleFilter],
  );
  // Alertes météo mineures/modérées masquées par défaut (l'OMM en publie plus d'un millier).
  const hasWeather = theme !== "all" && THEME_CATEGORIES[theme]?.includes("weather");
  const weatherCounts = useMemo(() => {
    if (!hasWeather) return null;
    const all = feeds.filter((item) => item.category === "weather" && inPeriod(item, period, now));
    const major = itemsForTheme(all, "weather", now).length;
    return { major, all: all.length };
  }, [feeds, hasWeather, period, now]);
  const visible = useMemo(() => sortChronological(themed.filter((item) => inPeriod(item, period, now)), now, theme === "space"), [themed, period, now, theme]);
  // Espace : les lancements planifiés forment une section « À venir » distincte.
  const upcoming = theme === "space" ? visible.filter((item) => isFuture(item, now)) : [];
  const past = theme === "space" ? visible.filter((item) => !isFuture(item, now)) : visible;
  const geolocated = visible.filter((item) => item.lat !== null && item.lon !== null).length;
  const failing = failingSourcesFor(feedSources, theme);
  const failedRequests = feedFailures.filter((f) => themeCovers(theme, f.category));
  const themeSources = feedSources.filter((s) => themeCovers(theme, s.category));
  // Avertissement commun d'une source : une fois en tête (hors « Tout », où les sources se mêlent).
  const shared = useMemo(() => (theme === "all" ? [] : sharedCaveats(visible)), [visible, theme]);
  const sharedSet = useMemo(() => new Set(shared.map((c) => c.caveat)), [shared]);
  const multiCategory = theme === "all" || (THEME_CATEGORIES[theme]?.length ?? 0) > 1;
  const periodLabel = PERIODS.find((p) => p.key === period);
  const isConflict = theme === "conflict";
  const busy = isConflict ? conflictsLoading : feedsStatus === "loading";
  const checkedAt = isConflict ? lastSync : feedsCheckedAt;

  return (
    <section className="panel corners boot feed-panel" aria-label={tr(locale, "Fil mondial", "World feed")}>
      <span className="corner" />
      <header className="feed-head">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="category-dot" style={{ background: THEME_COLORS[theme] }} />
            <h2 className="panel-title">
              {tr(locale, "Fil mondial", "World feed")} · {label(THEME_TAB_LABELS[theme], locale)}
            </h2>
          </div>
          <p
            className="meta mt-0.5"
            title={
              theme === "all"
                ? tr(
                    locale,
                    "Restent dans leur onglet : cotations, positions d'aéronefs, mesures de connectivité, alertes météo mineures ou modérées, événements à venir.",
                    "Kept in their own tab: quotes, aircraft positions, connectivity measurements, minor or moderate weather alerts, upcoming events.",
                  )
                : undefined
            }
          >
            {isConflict
              ? tr(locale, "Données de conflit ingérées : trois natures séparées", "Ingested conflict data: three separate kinds")
              : label(THEME_SUBTITLES[theme] ?? THEME_SUBTITLES.all!, locale)}
          </p>
        </div>
        <button
          type="button"
          className="icon-button shrink-0"
          onClick={() => void (isConflict ? refreshConflicts() : refreshFeeds())}
          disabled={busy}
          aria-busy={busy}
          aria-label={tr(locale, "Actualiser maintenant", "Refresh now")}
          title={`${tr(locale, "Actualiser maintenant", "Refresh now")}${checkedAt ? ` — ${tr(locale, "dernière vérification", "last check")} : ${absoluteDateTime(checkedAt, locale)}` : ""}`}
        >
          <span className={busy ? "spin" : undefined} aria-hidden>
            ↻
          </span>
        </button>
      </header>

      {isConflict ? (
        <ConflictsPanel locale={locale} now={now} />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 px-4 pt-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={tr(locale, "Période", "Period")}>
              {PERIODS.map((p) => (
                <button key={p.key} type="button" className="chip" data-active={period === p.key} aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>
                  {p[locale]}
                </button>
              ))}
            </div>
            <span className="meta shrink-0">
              {visible.length} / {themed.length}
            </span>
          </div>
          {checkedAt ? (
            <p className="meta px-4 pt-1" title={absoluteDateTime(checkedAt, locale)}>
              {tr(locale, "Vérifié", "Checked")} {relativeTime(checkedAt, locale, now)} ·{" "}
              {theme === "military" ? tr(locale, "auto. toutes les 30 s", "auto every 30 s") : tr(locale, "auto. toutes les 2 min", "auto every 2 min")} ·{" "}
              {tr(locale, `${geolocated} localisé(s) sur le globe`, `${geolocated} located on the globe`)}
            </p>
          ) : null}

          {theme === "uap" ? <UapNotice locale={locale} /> : null}

          {vehicleCounts ? (
            <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2" role="group" aria-label={tr(locale, "Mobiles affichés", "Vehicles shown")}>
              {(
                [
                  ["all", tr(locale, "Tous", "All"), vehicleCounts.aircraft + vehicleCounts.vessel],
                  ["aircraft", tr(locale, "Avions", "Aircraft"), vehicleCounts.aircraft],
                  ["vessel", tr(locale, "Navires", "Vessels"), vehicleCounts.vessel],
                ] as const
              ).map(([key, text, n]) => (
                <button key={key} type="button" className="chip" data-active={vehicleFilter === key} aria-pressed={vehicleFilter === key} onClick={() => setVehicleFilter(key)}>
                  {text} · {n}
                </button>
              ))}
            </div>
          ) : null}

          {weatherCounts ? (
            <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2" role="group" aria-label={tr(locale, "Alertes météo affichées", "Weather alerts shown")}>
              <span className="meta">{tr(locale, "Alertes météo :", "Weather alerts:")}</span>
              <button
                type="button"
                className="chip"
                data-active={!weatherAll}
                aria-pressed={!weatherAll}
                onClick={() => setWeatherAll(false)}
                title={tr(locale, "Sévérité « severe » ou « extreme » publiée par la source (ou non publiée, ex. avis de cyclone)", "Severity “severe” or “extreme” published by the source (or not published, e.g. cyclone advisories)")}
              >
                {tr(locale, "Sévères", "Severe")} · {weatherCounts.major}
              </button>
              <button type="button" className="chip" data-active={weatherAll} aria-pressed={weatherAll} onClick={() => setWeatherAll(true)}>
                {tr(locale, "Toutes", "All")} · {weatherCounts.all}
              </button>
            </div>
          ) : null}

          {shared.length === 1 ? (
            <p className="feed-caveat shared-caveat mx-4 mt-2">
              <span className="text-[#cfe6f5]">{shared[0].sourceName} :</span> {shared[0].caveat}
            </p>
          ) : shared.length > 1 ? (
            // Plusieurs sources : avertissements regroupés, repliés (lisibles d'un clic).
            <details className="info-box mx-4 mt-2">
              <summary>{tr(locale, `Avertissements des sources (${shared.length})`, `Source caveats (${shared.length})`)}</summary>
              <ul className="mt-2 space-y-1">
                {shared.map((c) => (
                  <li key={c.sourceName + c.caveat} className="feed-caveat">
                    <span className="text-[#cfe6f5]">{c.sourceName} :</span> {c.caveat}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {failedRequests.length || failing.length ? (
            <div className="mx-4 mt-2" role="status" aria-live="polite">
              <SourcesButton issueCounts={{
                unavailable: failing.filter((source) => source.status !== "stale" && source.health !== "stale").length,
                stale: failing.filter((source) => source.status === "stale" || source.health === "stale").length,
                services: failedRequests.length,
              }} />
            </div>
          ) : null}

          <ul className="scroll-thin mt-2 min-h-0 flex-1 overflow-y-auto pb-2" aria-live="polite" aria-busy={busy}>
            {upcoming.length ? <li className="list-heading">{tr(locale, `À venir (${upcoming.length})`, `Upcoming (${upcoming.length})`)}</li> : null}
            {upcoming.map((item) => (
              <FeedItemRow key={item.id} item={item} locale={locale} now={now} showCategory={false} hideCaveat={sharedSet.has(item.caveat ?? "")} />
            ))}
            {upcoming.length && past.length ? <li className="list-heading">{tr(locale, "Lancements passés", "Past launches")}</li> : null}
            {past.slice(0, MAX_ROWS).map((item) => (
              <FeedItemRow key={item.id} item={item} locale={locale} now={now} showCategory={multiCategory} hideCaveat={sharedSet.has(item.caveat ?? "")} />
            ))}
            {!visible.length ? (
              <li className="empty-note">
                {feedsStatus === "loading" && !feeds.length ? (
                  tr(locale, "Chargement des flux…", "Loading feeds…")
                ) : feedsStatus === "error" && !feeds.length ? (
                  tr(locale, "Les flux mondiaux sont indisponibles pour le moment. Nouvel essai automatique dans 2 min.", "World feeds are unavailable right now. Automatic retry in 2 min.")
                ) : !themeSources.length && !failedRequests.length ? (
                  // Aucune source déclarée pour ce thème : service en cours de branchement côté serveur.
                  tr(locale, "Source en cours de chargement ou pas encore branchée pour ce thème. Nouvel essai automatique dans 2 min.", "Source loading or not connected yet for this theme. Automatic retry in 2 min.")
                ) : (
                  <>
                    {period === "all"
                      ? tr(locale, "Aucun élément reçu des sources couvertes.", "No item received from the covered sources.")
                      : tr(locale, `Aucun élément sur ${periodLabel?.fr} dans les sources couvertes.`, `No item over ${periodLabel?.en} in the covered sources.`)}
                    {themeSources.length ? (
                      <span className="mt-1 block">
                        {tr(locale, "Sources couvertes", "Covered sources")} : {themeSources.map((s) => s.sourceName).join(" · ")}
                      </span>
                    ) : null}
                    {weatherCounts && !weatherAll && weatherCounts.all > weatherCounts.major ? (
                      <button type="button" className="chip mr-2 mt-2" onClick={() => setWeatherAll(true)}>
                        {tr(locale, `Voir les ${weatherCounts.all} alertes météo`, `Show all ${weatherCounts.all} weather alerts`)}
                      </button>
                    ) : null}
                    {period !== "all" && themed.length ? (
                      <button type="button" className="chip mt-2" onClick={() => setPeriod(period === "24h" ? "7d" : "all")}>
                        {period === "24h" ? tr(locale, "Élargir à 7 j", "Widen to 7 d") : tr(locale, "Tout afficher", "Show all")}
                      </button>
                    ) : null}
                  </>
                )}
              </li>
            ) : null}
            {past.length > MAX_ROWS ? (
              <li className="empty-note">
                {tr(locale, `${past.length - MAX_ROWS} éléments plus anciens non affichés.`, `${past.length - MAX_ROWS} older items not shown.`)}
              </li>
            ) : null}
          </ul>
        </>
      )}
    </section>
  );
}
