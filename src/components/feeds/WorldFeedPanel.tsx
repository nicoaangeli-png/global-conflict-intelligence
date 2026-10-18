"use client";

import { useEffect, useMemo, useState } from "react";
import { absoluteDateTime, relativeTime } from "@/lib/format";
import { tr, type Locale } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import { FeedItemRow } from "./FeedItem";
import { ConflictsPanel } from "./ConflictsPanel";
import {
  PERIODS,
  THEME_COLORS,
  defaultPeriod,
  THEME_LABELS,
  failingSourcesFor,
  inPeriod,
  isFuture,
  itemsForTheme,
  label,
  sortChronological,
  type PeriodKey,
  type ThemeKey,
} from "./feedModel";
import { useNow } from "./useNow";

/**
 * Panneau « FIL MONDIAL » : liste chronologique des éléments du thème actif,
 * avec état réel de chaque source (chargement, erreur par source, vide honnête).
 */

const THEME_SUBTITLES: Partial<Record<ThemeKey, { fr: string; en: string }>> = {
  all: { fr: "Actualité de tous les flux, du plus récent au plus ancien (hors cotations et événements à venir)", en: "News from all feeds, newest first (excluding quotes and upcoming events)" },
  social: { fr: "Manifestations, émeutes, grèves — signaux presse", en: "Protests, riots, strikes — press signals" },
  disaster: { fr: "Séismes, cyclones, inondations, feux — alertes et mesures", en: "Earthquakes, cyclones, floods, fires — alerts and measurements" },
  health: { fr: "Épidémies — bulletins officiels", en: "Outbreaks — official bulletins" },
  un: { fr: "Actualités et communiqués de l'ONU", en: "UN news and press releases" },
  space: { fr: "Lancements spatiaux — passés et planifiés", en: "Space launches — past and scheduled" },
  nuclear: { fr: "Nucléaire civil et militaire — presse spécialisée", en: "Civil and military nuclear — trade press" },
  economy: { fr: "Indices boursiers et devises — cotations", en: "Stock indices and currencies — quotes" },
  uap: { fr: "Dossiers OVNI / PAN — rapports officiels publiés", en: "UAP files — published official reports" },
};

const MAX_ROWS = 200;

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
            "AARO (Pentagone, États-Unis) publie ses rapports sur aaro.mil ; son état de collecte figure ci-dessous et dans « Sources ».",
            "AARO (Pentagon, USA) publishes its reports on aaro.mil; its collection status appears below and in “Sources”.",
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
  const refreshConflicts = useIntelStore((s) => s.refresh);
  const conflictsLoading = useIntelStore((s) => s.loading);
  const lastSync = useIntelStore((s) => s.lastSync);
  const now = useNow();
  // Période par défaut adaptée au rythme de publication du thème (voir `defaultPeriod`).
  const [period, setPeriod] = useState<PeriodKey>(() => defaultPeriod(theme));
  useEffect(() => {
    setPeriod(defaultPeriod(theme));
  }, [theme]);

  const themed = useMemo(() => itemsForTheme(feeds, theme, now), [feeds, theme, now]);
  const visible = useMemo(() => sortChronological(themed.filter((item) => inPeriod(item, period, now)), now, theme === "space"), [themed, period, now, theme]);
  // Espace : les lancements planifiés forment une section « À venir » distincte.
  const upcoming = theme === "space" ? visible.filter((item) => isFuture(item, now)) : [];
  const past = theme === "space" ? visible.filter((item) => !isFuture(item, now)) : visible;
  const geolocated = visible.filter((item) => item.lat !== null && item.lon !== null).length;
  const failing = failingSourcesFor(feedSources, theme);
  const failedRequests = feedFailures.filter((f) => theme === "all" || f.category === theme);
  const themeSources = feedSources.filter((s) => theme === "all" || s.category === theme);
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
              {tr(locale, "Fil mondial", "World feed")} · {label(THEME_LABELS[theme], locale)}
            </h2>
          </div>
          <p className="meta mt-0.5">
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
              {tr(locale, "Vérifié", "Checked")} {relativeTime(checkedAt, locale, now)} · {tr(locale, "auto. toutes les 2 min", "auto every 2 min")} ·{" "}
              {tr(locale, `${geolocated} localisé(s) sur le globe`, `${geolocated} located on the globe`)}
            </p>
          ) : null}

          {theme === "uap" ? <UapNotice locale={locale} /> : null}

          {failedRequests.length || failing.length ? (
            <ul className="mx-4 mt-2 space-y-1" aria-live="polite">
              {failedRequests.map((f) => (
                <li key={`req-${f.category}`} className="error-note">
                  {tr(locale, "Service des flux indisponible", "Feed service unavailable")} ({label(THEME_LABELS[f.category], locale)}) : {f.error}
                </li>
              ))}
              {failing.map((s) => (
                <li key={s.sourceId} className="error-note">
                  {s.status === "stale" ? tr(locale, "Source en retard", "Stale source") : tr(locale, "Source indisponible", "Source unavailable")} : {s.sourceName}
                  {s.message ? ` — ${s.message}` : ""}
                </li>
              ))}
            </ul>
          ) : null}

          <ul className="scroll-thin mt-2 min-h-0 flex-1 overflow-y-auto pb-2" aria-live="polite" aria-busy={busy}>
            {upcoming.length ? <li className="list-heading">{tr(locale, `À venir (${upcoming.length})`, `Upcoming (${upcoming.length})`)}</li> : null}
            {upcoming.map((item) => (
              <FeedItemRow key={item.id} item={item} locale={locale} now={now} showCategory={false} />
            ))}
            {upcoming.length && past.length ? <li className="list-heading">{tr(locale, "Lancements passés", "Past launches")}</li> : null}
            {past.slice(0, MAX_ROWS).map((item) => (
              <FeedItemRow key={item.id} item={item} locale={locale} now={now} showCategory={theme === "all"} />
            ))}
            {!visible.length ? (
              <li className="empty-note">
                {feedsStatus === "loading" && !feeds.length ? (
                  tr(locale, "Chargement des flux…", "Loading feeds…")
                ) : feedsStatus === "error" && !feeds.length ? (
                  tr(locale, "Les flux mondiaux sont indisponibles pour le moment. Nouvel essai automatique dans 2 min.", "World feeds are unavailable right now. Automatic retry in 2 min.")
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
