"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tr, type Locale } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import type { EvidenceNature, OrbitalEvent } from "@/types/detection";
import { canFocusEvent, sourceHref, statusLabel, utcTime } from "./presentation";
import { useDetection } from "./useDetection";

export function DetectionPanel({ visible }: { visible: boolean }) {
  const locale = useIntelStore((state) => state.locale);
  const focus = useIntelStore((state) => state.focus);
  const { data, failed } = useDetection();
  const [view, setView] = useState<"list" | "detail" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const stripRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const event = data?.events.find((item) => item.id === selectedId) ?? data?.live.find((item) => item.id === selectedId);

  useEffect(() => { if (!visible) setView(null); }, [visible]);
  useEffect(() => {
    if (!view) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-detection-close]")?.focus();
    return () => {
      dialog.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
      else stripRef.current?.focus();
    };
  }, [Boolean(view)]);
  useEffect(() => {
    if (view) dialogRef.current?.querySelector<HTMLElement>("[data-detection-close]")?.focus();
  }, [view, selectedId]);

  const open = (id: string | null) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setSelectedId(id);
    setView(id ? "detail" : "list");
  };
  const count = data?.events.length ?? 0;
  const live = data?.live ?? [];

  return <>
    <section className="detection-strip" hidden={!visible} aria-label={tr(locale, "Détection ORBITAL", "ORBITAL detection")}>
      <span className="detection-live-label">LIVE</span>
      <span className="detection-health" role="status">{failed
        ? tr(locale, "Indisponible · données précédentes non actualisées", "Unavailable · previous data not updated")
        : !data ? tr(locale, "Chargement…", "Loading…")
        : !live.length ? tr(locale, "Aucun événement prioritaire dans la réponse", "No priority events in this response") : ""}</span>
      {!failed && live.slice(0, 2).map((item) => <button type="button" className="detection-headline" key={item.id} onClick={() => open(item.id)}>
        <span>{statusLabel(item.status, locale)} · {item.confidenceScore}/100</span> {item.title}
      </button>)}
      <button type="button" className="chip detection-all" ref={stripRef} onClick={() => open(null)} aria-haspopup="dialog">
        {tr(locale, "Tous les signaux", "All signals")} {data ? `(${count})` : ""}
      </button>
    </section>
    {view && createPortal(<dialog ref={dialogRef} className="detection-dialog panel" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(keyboardEvent) => { keyboardEvent.preventDefault(); setView(null); }}
      onKeyDown={(keyboardEvent) => {
        if (keyboardEvent.key === "Escape") { keyboardEvent.preventDefault(); keyboardEvent.stopPropagation(); setView(null); }
        if (keyboardEvent.key !== "Tab") return;
        const controls = Array.from(keyboardEvent.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], summary, [tabindex='0']"))
          .filter((control) => control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (keyboardEvent.shiftKey && document.activeElement === first) { keyboardEvent.preventDefault(); last?.focus(); }
        else if (!keyboardEvent.shiftKey && document.activeElement === last) { keyboardEvent.preventDefault(); first?.focus(); }
      }}>
      <header className="detection-dialog-heading">
        <h2 id={titleId}>{view === "detail" ? tr(locale, "Détail de détection", "Detection detail") : tr(locale, "Tous les signaux", "All signals")}</h2>
        <button type="button" className="chip" data-detection-close onClick={() => setView(null)} aria-label={tr(locale, "Fermer la détection", "Close detection")}>✕</button>
      </header>
      <div className="detection-dialog-body scroll-thin">
        <p className="meta" id={descriptionId}>{tr(locale, "Évaluation ORBITAL, pas une probabilité statistique. Un signal n’est pas une confirmation.", "ORBITAL assessment, not a statistical probability. A signal is not a confirmation.")}</p>
        {failed && <p role="status" className="detection-warning">{tr(locale, "Service indisponible : les dernières données reçues peuvent être périmées.", "Service unavailable: the last received data may be stale.")}</p>}
        {data && <p className="meta">{tr(locale, "Réponse générée : ", "Response generated: ")}{utcTime(data.generatedAt, locale)}</p>}
        {view === "detail" ? <>
          <button type="button" className="chip" onClick={() => setView("list")}>← {tr(locale, "Tous les signaux", "All signals")}</button>
          {event ? <EventDetail event={event} locale={locale} onFocus={canFocusEvent(event.position) ? () => {
            if (canFocusEvent(event.position)) focus(event.position.lat, event.position.lon);
            setView(null);
          } : undefined} /> : <p role="status">{tr(locale, "Cet événement n’est plus présent dans la réponse courante.", "This event is no longer in the current response.")}</p>}
        </> : <>
          <p className="meta">{tr(locale, "Inclut les signaux de moindre importance ; aucune collecte supplémentaire.", "Includes smaller signals; no additional collection.")}</p>
          {!data ? <p>{failed ? tr(locale, "Aucune réponse disponible.", "No response available.") : tr(locale, "Chargement…", "Loading…")}</p>
            : count === 0 ? <p>{tr(locale, "Aucun signal dans cette réponse. Cela ne démontre pas l’absence d’événements.", "No signals in this response. This does not establish the absence of events.")}</p>
            : <ul className="detection-event-list">{data.events.map((item) => <li key={item.id}>
              <button type="button" onClick={() => { setSelectedId(item.id); setView("detail"); }}>
                <strong>{item.title}</strong><span>{statusLabel(item.status, locale)} · {item.confidenceScore}/100 · {item.evidenceCount} {tr(locale, "éléments", "evidence items")}</span>
                <span>{item.place ?? item.countries.join(", ")} · {utcTime(item.lastReceivedAt, locale)}</span>
              </button>
            </li>)}</ul>}
        </>}
      </div>
    </dialog>, document.body)}
  </>;
}

function EventDetail({ event, locale, onFocus }: { event: OrbitalEvent; locale: Locale; onFocus?: () => void }) {
  const natureLabels: Record<EvidenceNature, string> = {
    press: tr(locale, "Presse", "Press"), official: tr(locale, "Source officielle", "Official source"),
    sensor: tr(locale, "Capteur", "Sensor"), structured: tr(locale, "Donnée structurée", "Structured record"), report: tr(locale, "Signalement", "Report"),
  };
  const timelineLabels = {
    first_signal: tr(locale, "Premier signal", "First signal"), evidence_added: tr(locale, "Élément ajouté", "Evidence added"),
    evidence_updated: tr(locale, "Élément actualisé", "Evidence updated"), assessment_changed: tr(locale, "Évaluation modifiée", "Assessment changed"),
  };
  return <article className="detection-event">
    <h3>{event.title}</h3>
    <p>{statusLabel(event.status, locale)} · {tr(locale, "Confiance", "Confidence")} {event.confidenceScore}/100</p>
    <p className="meta">{event.place ?? (event.countries.join(", ") || tr(locale, "Lieu inconnu", "Unknown place"))} · {tr(locale, "Précision", "Precision")}: {event.position ? ({ point: tr(locale, "point", "point"), city: tr(locale, "ville", "city"), region: tr(locale, "région", "region"), country: tr(locale, "pays", "country"), unknown: tr(locale, "inconnue", "unknown") })[event.position.precision] : tr(locale, "inconnue", "unknown")}</p>
    {onFocus ? <button type="button" className="chip" onClick={onFocus}>{tr(locale, "Localiser sur le globe", "Locate on globe")}</button>
      : <p className="meta">{tr(locale, "Localisation trop imprécise : aucun recentrage du globe.", "Location too imprecise: globe focus is disabled.")}</p>}
    <dl className="detection-counts">
      <div><dt>{tr(locale, "Fournisseurs distincts", "Distinct providers")}</dt><dd>{event.distinctProviderCount}</dd></div>
      <div><dt>{tr(locale, "Sources indépendantes", "Independent sources")}</dt><dd>{event.independentSourceCount}</dd></div>
      <div><dt>{tr(locale, "Éléments de preuve", "Evidence items")}</dt><dd>{event.evidenceCount}</dd></div>
    </dl>
    <p className="meta">{tr(locale, "Plusieurs fournisseurs peuvent reprendre la même dépêche. Le nombre d’éléments n’est pas le nombre de sources indépendantes.", "Multiple providers may relay the same dispatch. Evidence count is not independent source count.")}</p>
    <h4>{tr(locale, "Explication du score", "Score explanation")}</h4>
    <p className="meta">{tr(locale, "Méthode", "Method")} v{event.confidence.version} · {tr(locale, "Base de confirmation", "Confirmation basis")}: {event.confidence.confirmationBasis === "official_observation" ? tr(locale, "observation officielle", "official observation") : event.confidence.confirmationBasis === "independent_evidence" ? tr(locale, "éléments indépendants", "independent evidence") : tr(locale, "aucune", "none")}</p>
    <ul>{event.confidence.factors.map((factor, index) => <li key={`${factor.code}-${index}`}><strong>{factor.points > 0 ? "+" : ""}{factor.points} {tr(locale, "points", "points")}</strong> · {factor.detail} <span className="meta">({factor.code})</span></li>)}</ul>
    <p className="meta">{tr(locale, "Importance", "Importance")}: {event.importanceScore}/100{event.importanceReasons.length > 0 ? ` · ${event.importanceReasons.join(" · ")}` : ""}</p>
    {event.confidence.caveats.length > 0 && <><h4>{tr(locale, "Réserves", "Caveats")}</h4><ul>{event.confidence.caveats.map((caveat, index) => <li key={index}>{caveat}</li>)}</ul></>}
    <h4>{tr(locale, "Contradictions", "Contradictions")}</h4>
    {event.contradictions.length ? <ul className="detection-warning">{event.contradictions.map((text, index) => <li key={index}>{text}</li>)}</ul>
      : <p className="meta">{tr(locale, "Aucune contradiction consignée ; cela ne prouve pas un consensus.", "No recorded contradictions; this does not establish consensus.")}</p>}
    <h4>{tr(locale, "Sources et éléments", "Sources and evidence")}</h4>
    {event.evidenceTruncated && <p className="detection-warning">{tr(locale, "Liste de preuves tronquée par le serveur ; les compteurs peuvent dépasser les éléments affichés.", "Evidence list truncated by the server; counts may exceed displayed items.")}</p>}
    <ul className="detection-evidence">{event.evidence.map((evidence) => {
      const signal = evidence.signal;
      const href = sourceHref(evidence.canonicalUrl) ?? sourceHref(signal.url);
      return <li key={signal.id}>
        <strong>{signal.title}</strong>
        <p>{natureLabels[signal.nature]} · {signal.sourceName} · {tr(locale, "Fournisseur", "Provider")}: {signal.provider}</p>
        <p className="meta">{signal.confirmsOccurrence ? tr(locale, "Cette source atteste une occurrence, selon l’évaluation serveur.", "This source attests an occurrence, according to the server assessment.") : tr(locale, "Cet élément seul n’atteste pas l’occurrence.", "This item alone does not attest the occurrence.")}</p>
        {signal.text && <p>{signal.text}</p>}
        <p className="meta">{tr(locale, "Groupe d’indépendance", "Independence group")}: {evidence.independenceGroup}</p>
        {evidence.dependenceReasons.length > 0 && <p className="meta">{tr(locale, "Dépendance", "Dependence")}: {evidence.dependenceReasons.join(" · ")}</p>}
        {signal.upstreamAgency && <p className="meta">{tr(locale, "Agence d’origine", "Upstream agency")}: {signal.upstreamAgency}</p>}
        <p className="meta">{tr(locale, "Occurrence", "Occurrence")}: {utcTime(signal.occurredAt, locale)}<br />{tr(locale, "Publication", "Publication")}: {utcTime(signal.publishedAt, locale)}<br />{tr(locale, "Réception", "Received")}: {utcTime(signal.receivedAt, locale)}</p>
        {signal.metric && <p>{signal.metric.label}: {signal.metric.value} {signal.metric.unit}</p>}
        {signal.caveat && <p className="detection-warning">{signal.caveat}</p>}
        {href ? <a href={href} target="_blank" rel="noopener noreferrer">{tr(locale, "Ouvrir la source", "Open source")} ↗ · {evidence.domain ?? signal.sourceName}</a>
          : <span className="meta">{tr(locale, "Lien source indisponible", "Source link unavailable")}</span>}
      </li>;
    })}</ul>
    <h4>{tr(locale, "Chronologie de détection", "Detection timeline")}</h4>
    <p className="meta">{tr(locale, "Occurrence de l’événement", "Event occurrence")}: {utcTime(event.occurredAt, locale)}<br />{tr(locale, "Première réception", "First received")}: {utcTime(event.firstReceivedAt, locale)}<br />{tr(locale, "Dernière réception", "Last received")}: {utcTime(event.lastReceivedAt, locale)}</p>
    {!event.timeline.length && <p className="meta">{tr(locale, "Chronologie indisponible.", "Timeline unavailable.")}</p>}
    <ol className="detection-timeline">{event.timeline.map((entry, index) => <li key={`${entry.at}-${index}`}>
      <time dateTime={entry.at}>{utcTime(entry.at, locale)}</time> · {timelineLabels[entry.type]} · {statusLabel(entry.status, locale)} · {entry.confidenceScore}/100 · {entry.independentSourceCount} {tr(locale, "sources indépendantes", "independent sources")}
    </li>)}</ol>
  </article>;
}
