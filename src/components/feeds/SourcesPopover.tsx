"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { absoluteDateTime, int, relativeTime } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import type { SourceHealth, SourcesStatusResponse } from "@/types/health";
import { THEME_COLORS, THEME_LABELS, label, latestDataDate, sourceStatusLabel, sourceTone } from "./feedModel";
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

function healthStatusLabel(status: SourceHealth["status"] | undefined, locale: "fr" | "en") {
  switch (status) {
    case "healthy": return tr(locale, "Opérationnelle", "Operational");
    case "degraded": return tr(locale, "Dégradée", "Degraded");
    case "stale": return tr(locale, "Données anciennes", "Stale data");
    case "unavailable": return tr(locale, "Indisponible", "Unavailable");
    case "unconfigured": return tr(locale, "Non branchée", "Not connected");
    case "pending": return tr(locale, "Pas encore interrogée", "Not queried yet");
    default: return tr(locale, "État non renseigné", "Status not reported");
  }
}

export function SourcesButton({ issueCounts }: { issueCounts?: { unavailable: number; stale: number; services: number } }) {
  const compact = issueCounts !== undefined;
  const [open, setOpen] = useState(false);
  const [healthById, setHealthById] = useState<Record<string, SourceHealth>>({});
  const locale = useIntelStore((s) => s.locale);
  const feedSources = useIntelStore((s) => s.feedSources);
  const feedFailures = useIntelStore((s) => s.feedFailures);
  const feedsStatus = useIntelStore((s) => s.feedsStatus);
  const feeds = useIntelStore((s) => s.feeds);
  const stats = useIntelStore((s) => s.stats);
  const now = useNow();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch("/api/sources/status", { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<SourcesStatusResponse> : null)
      .then((response) => {
        if (response && Array.isArray(response.sources)) {
          setHealthById(Object.fromEntries(response.sources.map((source) => [source.id, source])));
        }
      })
      .catch(() => { /* Le panneau conserve les états déjà reçus par les flux. */ });
    return () => controller.abort();
  }, [open]);

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
      if (rootRef.current && !rootRef.current.contains(e.target as Node) && !panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  useEffect(() => {
    if (open && compact) panelRef.current?.focus();
  }, [open, compact]);

  const conflictSources = (stats?.sources ?? []).filter((s) => CONFLICT_SOURCE_INFO[s.dataset]);
  const acled = stats?.connectors.find((c) => c.id === "acled");
  const okFeeds = feedSources.filter((s) => s.status === "ok").length;
  const problems = feedSources.filter((s) => ["error", "warn"].includes(sourceTone(s))).length + feedFailures.length;
  const total = feedSources.length + conflictSources.length;
  const ok = okFeeds + conflictSources.length;
  const tone = feedsStatus === "error" ? "error" : problems ? "warn" : "ok";
  const issueSummary = issueCounts ? [
    issueCounts.unavailable ? tr(locale, `${issueCounts.unavailable} indisponible${issueCounts.unavailable > 1 ? "s" : ""}`, `${issueCounts.unavailable} unavailable`) : null,
    issueCounts.stale ? tr(locale, `${issueCounts.stale} en retard`, `${issueCounts.stale} stale`) : null,
    issueCounts.services ? tr(locale, `${issueCounts.services} service${issueCounts.services > 1 ? "s" : ""} indisponible${issueCounts.services > 1 ? "s" : ""}`, `${issueCounts.services} service${issueCounts.services > 1 ? "s" : ""} unavailable`) : null,
  ].filter(Boolean).join(" · ") : "";

  const panel = open ? (
    <div ref={panelRef} id={panelId} role="dialog" tabIndex={-1} aria-label={tr(locale, "Sources de données", "Data sources")} className={`panel corners sources-popover scroll-thin${compact ? " feed-sources-popover" : ""}`}>
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
          const health = healthById[`connector:${s.dataset === "import:csv" ? "csv" : s.dataset}`];
          const connectorTone = health?.status === "healthy" ? "ok" : health?.status === "unavailable" || health?.status === "degraded" || health?.status === "stale" ? "warn" : "off";
          return (
            <li key={s.dataset} className="source-row">
              <span className="status-dot" data-tone={connectorTone} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-[#e3f3ff]">
                  {info.homepage ? (
                    <a href={info.homepage} target="_blank" rel="noopener noreferrer" className="hover:underline">{info.name}</a>
                  ) : info.name}{" "}
                  <span className="meta">· {label(info.nature, locale)}</span>
                </span>
                <span className="meta block">
                  {tr(locale, "Donnée la plus récente", "Latest data")} : {s.latestEventAt ? (
                    <span title={absoluteDateTime(s.latestEventAt, locale)}>{absoluteDateTime(s.latestEventAt, locale)} ({relativeTime(s.latestEventAt, locale, now)})</span>
                  ) : tr(locale, "aucune", "none")}{" "}
                  · {int(s.recordsInStore)} {tr(locale, "enregistrements", "records")}
                </span>
                <span className="meta block">{tr(locale, "État", "Status")} : {healthStatusLabel(health?.status, locale)}</span>
                <span className="meta block">{tr(locale, "Dernier succès", "Last success")} : {health?.lastSuccessAt ? absoluteDateTime(health.lastSuccessAt, locale) : tr(locale, "inconnu", "unknown")}</span>
                <span className="meta block">{tr(locale, "Dernière erreur", "Last error")} : {health?.lastError ?? tr(locale, "aucune connue", "none known")}</span>
                <span className="meta block">{tr(locale, "Message", "Message")} : {health?.lastError ?? tr(locale, "aucun", "none")}</span>
                <span className="meta block">{tr(locale, "Dernière tentative", "Last attempt")} : {health?.lastAttemptAt ? absoluteDateTime(health.lastAttemptAt, locale) : tr(locale, "inconnue", "unknown")}</span>
              </span>
            </li>
          );
        })}
        {acled && !acled.configured ? <li className="source-row"><span className="status-dot" data-tone="off" /><span className="meta">ACLED · {tr(locale, "non branché (identifiants absents)", "not connected (no credentials)")}</span></li> : null}
        {!conflictSources.length ? <li className="meta">{tr(locale, "État des sources de conflit : chargement…", "Conflict source status: loading…")}</li> : null}
      </ul>

      <h3 className="section-title mt-3">{tr(locale, "Flux mondiaux", "World feeds")}</h3>
      {feedFailures.length ? (
        <ul className="mt-1.5 space-y-1">
          {feedFailures.map((f) => <li key={f.category} className="source-warning">{label(THEME_LABELS[f.category], locale)} : {tr(locale, "service indisponible", "service unavailable")} ({f.error})</li>)}
        </ul>
      ) : null}
      <ul className="mt-1.5 space-y-1.5">
        {feedSources.map((s) => {
          const latest = latestDataDate(feeds, s.sourceId, now);
          const health = healthById[`feed:${s.sourceId}`];
          const currentState = { ...s, health: health?.status ?? s.health };
          const tone = sourceTone(currentState) === "error" ? "warn" : sourceTone(currentState);
          const lastSuccess = health?.lastSuccessAt ?? s.lastSuccessAt;
          const lastError = health?.lastError ?? ((s.status === "error" || s.status === "stale") ? s.message : null);
          return (
            <li key={s.sourceId} className="source-row">
              <span className="status-dot" data-tone={tone} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] text-[#e3f3ff]">
                  <a href={s.homepage} target="_blank" rel="noopener noreferrer" className="hover:underline">{s.sourceName}</a>{" "}
                  <span className="meta" style={{ color: THEME_COLORS[s.category] }}>· {label(THEME_LABELS[s.category], locale)}</span>
                </span>
                <span className="meta block">{tr(locale, "État", "Status")} : {sourceStatusLabel(currentState, locale)}</span>
                {s.status === "ok" || s.status === "stale" ? <span className="meta block">{tr(locale, "Donnée la plus récente", "Latest data")} : {latest ? `${absoluteDateTime(latest, locale)} (${relativeTime(latest, locale, now)})` : tr(locale, "aucun élément daté reçu", "no dated item received")}</span> : null}
                <span className="meta block">{tr(locale, "Dernier succès", "Last success")} : {lastSuccess ? absoluteDateTime(lastSuccess, locale) : tr(locale, "inconnu", "unknown")}</span>
                <span className="meta block">{tr(locale, "Dernière erreur", "Last error")} : {lastError ?? tr(locale, "aucune connue", "none known")}</span>
                <span className="meta block">{tr(locale, "Message", "Message")} : {s.message ?? tr(locale, "aucun", "none")}</span>
                <span className="meta block">{tr(locale, "Dernière tentative", "Last attempt")} : {health?.lastAttemptAt ? absoluteDateTime(health.lastAttemptAt, locale) : tr(locale, "inconnue", "unknown")}</span>
                {s.license ? <span className="meta block">{tr(locale, "Licence", "License")} : {s.license}</span> : null}
              </span>
            </li>
          );
        })}
        {!feedSources.length && feedsStatus === "loading" ? <li className="meta">{tr(locale, "Chargement…", "Loading…")}</li> : null}
        {!feedSources.length && feedsStatus === "error" ? <li className="source-warning">{tr(locale, "Service des flux indisponible.", "Feed service unavailable.")}</li> : null}
      </ul>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={compact ? "source-summary-button" : "header-button"}
        data-tone={compact ? "warn" : tone}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        title={tr(locale, "État et date réelle de chaque source", "Status and actual data date of each source")}
      >
        <span className="status-dot" data-tone={compact ? "warn" : tone} />
        {issueCounts ? (
          <span>{tr(locale, "Sources", "Sources")} · {issueSummary}</span>
        ) : <>{tr(locale, "Sources", "Sources")}<span className="text-[#8fb4cc]">{total && feedSources.length ? `${ok}/${total}` : feedsStatus === "error" ? "!" : "…"}</span></>}
      </button>
      {compact && panel ? createPortal(panel, document.body) : panel}
    </div>
  );
}
