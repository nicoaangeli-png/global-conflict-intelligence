"use client";

import { useEffect, useRef, useState } from "react";
import { absoluteDateTime, int, relativeTime } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import { THEME_COLORS, THEME_LABELS, label, latestDataDate, sourceStatusLabel } from "./feedModel";
import { useNow } from "./useNow";

/**
 * Indicateur « Sources » de l'en-tête : remplace les anciens bandeaux de
 * provenance. Ouvre la liste des sources avec leur état réel et la date de
 * leur donnée la plus récente (jamais la seule date de collecte).
 */

const CONFLICT_SOURCE_INFO: Record<string, { name: string; nature: { fr: string; en: string }; homepage: string }> = {
  gdelt: { name: "GDELT 2.0", nature: { fr: "Articles de presse (non confirmés)", en: "Press articles (unconfirmed)" }, homepage: "https://www.gdeltproject.org/" },
  ucdp: { name: "UCDP GED", nature: { fr: "Incidents vérifiés (publication différée)", en: "Verified incidents (delayed release)" }, homepage: "https://ucdp.uu.se/" },
  acled: { name: "ACLED", nature: { fr: "Incidents vérifiés", en: "Verified incidents" }, homepage: "https://acleddata.com/" },
  firms: { name: "NASA FIRMS", nature: { fr: "Détections satellite (anomalies thermiques)", en: "Satellite detections (thermal anomalies)" }, homepage: "https://firms.modaps.eosdis.nasa.gov/" },
  "import:csv": { name: "Import CSV", nature: { fr: "Import opérateur", en: "Operator import" }, homepage: "" },
};

export function SourcesButton() {
  const [open, setOpen] = useState(false);
  const locale = useIntelStore((s) => s.locale);
  const feedSources = useIntelStore((s) => s.feedSources);
  const feedFailures = useIntelStore((s) => s.feedFailures);
  const feedsStatus = useIntelStore((s) => s.feedsStatus);
  const feeds = useIntelStore((s) => s.feeds);
  const stats = useIntelStore((s) => s.stats);
  const now = useNow();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const conflictSources = (stats?.sources ?? []).filter((s) => CONFLICT_SOURCE_INFO[s.dataset]);
  const acled = stats?.connectors.find((c) => c.id === "acled");
  const okFeeds = feedSources.filter((s) => s.status === "ok").length;
  const problems = feedSources.filter((s) => s.status === "error" || s.status === "stale").length + feedFailures.length;
  const total = feedSources.length + conflictSources.length;
  const ok = okFeeds + conflictSources.length;
  const tone = feedsStatus === "error" ? "error" : problems ? "warn" : "ok";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="header-button"
        data-tone={tone}
        aria-expanded={open}
        aria-controls="sources-popover"
        onClick={() => setOpen((v) => !v)}
        title={tr(locale, "État et date réelle de chaque source", "Status and actual data date of each source")}
      >
        <span className="status-dot" data-tone={tone} />
        {tr(locale, "Sources", "Sources")}
        <span className="text-[#8fb4cc]">{total && feedSources.length ? `${ok}/${total}` : feedsStatus === "error" ? "!" : "…"}</span>
      </button>
      {open ? (
        <div id="sources-popover" role="dialog" aria-label={tr(locale, "Sources de données", "Data sources")} className="panel corners sources-popover scroll-thin">
          <span className="corner" />
          <p className="meta">
            {tr(
              locale,
              "Couverture non exhaustive. « Donnée la plus récente » = date propre de l'élément (événement ou publication), distincte de la collecte.",
              "Coverage is not exhaustive. “Latest data” = the item's own date (event or publication), distinct from collection.",
            )}
          </p>

          <h3 className="section-title mt-3">{tr(locale, "Conflits armés (base ORBITAL)", "Armed conflicts (ORBITAL store)")}</h3>
          <ul className="mt-1.5 space-y-1.5">
            {conflictSources.map((s) => {
              const info = CONFLICT_SOURCE_INFO[s.dataset];
              return (
                <li key={s.dataset} className="source-row">
                  <span className="status-dot" data-tone={s.recordsInStore > 0 ? "ok" : "warn"} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] text-[#e3f3ff]">
                      {info.homepage ? (
                        <a href={info.homepage} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {info.name}
                        </a>
                      ) : (
                        info.name
                      )}{" "}
                      <span className="meta">· {label(info.nature, locale)}</span>
                    </span>
                    <span className="meta block">
                      {tr(locale, "Donnée la plus récente", "Latest data")} :{" "}
                      {s.latestEventAt ? (
                        <span title={absoluteDateTime(s.latestEventAt, locale)}>
                          {absoluteDateTime(s.latestEventAt, locale)} ({relativeTime(s.latestEventAt, locale, now)})
                        </span>
                      ) : (
                        tr(locale, "aucune", "none")
                      )}{" "}
                      · {int(s.recordsInStore)} {tr(locale, "enregistrements", "records")}
                    </span>
                  </span>
                </li>
              );
            })}
            {acled && !acled.configured ? (
              <li className="source-row">
                <span className="status-dot" data-tone="off" />
                <span className="meta">ACLED · {tr(locale, "non branché (identifiants absents)", "not connected (no credentials)")}</span>
              </li>
            ) : null}
            {!conflictSources.length ? <li className="meta">{tr(locale, "État des sources de conflit : chargement…", "Conflict source status: loading…")}</li> : null}
          </ul>

          <h3 className="section-title mt-3">{tr(locale, "Flux mondiaux", "World feeds")}</h3>
          {feedFailures.length ? (
            <ul className="mt-1.5 space-y-1">
              {feedFailures.map((f) => (
                <li key={f.category} className="error-note">
                  {label(THEME_LABELS[f.category], locale)} : {tr(locale, "service indisponible", "service unavailable")} ({f.error})
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="mt-1.5 space-y-1.5">
            {feedSources.map((s) => {
              const latest = latestDataDate(feeds, s.sourceId, now);
              const tone = s.status === "ok" ? "ok" : s.status === "not_configured" ? "off" : s.status === "stale" ? "warn" : "error";
              return (
                <li key={s.sourceId} className="source-row">
                  <span className="status-dot" data-tone={tone} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] text-[#e3f3ff]">
                      <a href={s.homepage} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {s.sourceName}
                      </a>{" "}
                      <span className="meta" style={{ color: THEME_COLORS[s.category] }}>
                        · {label(THEME_LABELS[s.category], locale)}
                      </span>
                    </span>
                    <span className="meta block">
                      {sourceStatusLabel(s, locale)}
                      {s.status === "ok" || s.status === "stale"
                        ? ` · ${tr(locale, "donnée la plus récente", "latest data")} : ${latest ? `${absoluteDateTime(latest, locale)} (${relativeTime(latest, locale, now)})` : tr(locale, "aucun élément daté reçu", "no dated item received")}`
                        : ""}
                      {s.fetchedAt ? ` · ${tr(locale, "collecte", "collected")} ${relativeTime(s.fetchedAt, locale, now)}` : ""}
                    </span>
                    {s.message ? <span className="meta block text-[#ffc58a]">{s.message}</span> : null}
                    {s.license ? <span className="meta block">{tr(locale, "Licence", "License")} : {s.license}</span> : null}
                  </span>
                </li>
              );
            })}
            {!feedSources.length && feedsStatus === "loading" ? <li className="meta">{tr(locale, "Chargement…", "Loading…")}</li> : null}
            {!feedSources.length && feedsStatus === "error" ? <li className="error-note">{tr(locale, "Service des flux indisponible.", "Feed service unavailable.")}</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
