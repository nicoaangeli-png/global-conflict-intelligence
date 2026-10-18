"use client";

import type { ConflictEvent } from "@/types/conflict";
import { absoluteDateTime, coords, int, relativeTime } from "@/lib/format";
import { tr, type Locale } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import { clusterBreakdown, clusterPrecision, clusterSummary, eventPrecisionLabel, precisionLabel } from "./conflictModel";
import { useNow } from "./useNow";

/**
 * Détail d'une zone signalée (foyer agrégé) : natures séparées, liste des
 * enregistrements avec titre réel quand la source le fournit, lien d'origine.
 */

function natureOfEvent(event: ConflictEvent, locale: Locale): { text: string; tone: "official" | "unconfirmed" | "neutral" } {
  if (event.confidence === "MEDIA_SIGNAL") return { text: tr(locale, "Presse — non confirmé", "Press — unconfirmed"), tone: "unconfirmed" };
  if (event.eventType === "Thermal anomaly") return { text: tr(locale, "Détection satellite", "Satellite detection"), tone: "neutral" };
  if (event.sourceDataset === "import:csv") return { text: tr(locale, "Import opérateur", "Operator import"), tone: "neutral" };
  return { text: tr(locale, "Incident vérifié", "Verified incident"), tone: "official" };
}

function EventRow({ event, locale, now }: { event: ConflictEvent; locale: Locale; now: number }) {
  const nature = natureOfEvent(event, locale);
  const press = event.confidence === "MEDIA_SIGNAL";
  const thermal = event.eventType === "Thermal anomaly";
  const title = event.title?.trim() || (press ? null : event.subEventType || event.eventType);
  return (
    <li className="mini-item">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="nature-badge" data-tone={nature.tone}>
          {nature.text}
        </span>
        <time className="meta ml-auto" dateTime={event.eventDate} title={absoluteDateTime(event.eventDate, locale)}>
          {relativeTime(event.eventDate, locale, now)}
        </time>
      </div>
      <p className="mt-1 text-[12px] leading-snug text-[#e3f3ff]">
        {title ?? tr(locale, "Titre non fourni par la source", "Title not provided by the source")}
      </p>
      <div className="flex items-center justify-between gap-2">
        <span className="meta min-w-0 break-words">
          {[event.locality, event.country].filter(Boolean).join(", ")}
          {eventPrecisionLabel(event, locale) ? ` · ${eventPrecisionLabel(event, locale)}` : ""}
          {!press && !thermal && event.fatalities > 0 ? ` · ${int(event.fatalities)} ${tr(locale, "morts (source)", "deaths (source)")}` : ""}
        </span>
        {event.sourceUrl ? (
          <a className="feed-link-inline" href={event.sourceUrl} target="_blank" rel="noopener noreferrer" title={event.source}>
            {tr(locale, "Source ↗", "Source ↗")}
          </a>
        ) : event.source ? (
          <span className="meta min-w-0 break-words">{event.source}</span>
        ) : null}
      </div>
    </li>
  );
}

export function ClusterDetail() {
  const selected = useIntelStore((s) => s.selected);
  const events = useIntelStore((s) => s.selectedEvents);
  const selecting = useIntelStore((s) => s.selecting);
  const select = useIntelStore((s) => s.select);
  const locale = useIntelStore((s) => s.locale);
  const now = useNow();
  if (!selected) return null;

  const b = clusterBreakdown(selected);
  const place = selected.locality || selected.region || selected.country || "—";
  const { latitude: lat, longitude: lon } = selected;

  return (
    <section className="panel corners boot inspector" aria-label={tr(locale, `Zone signalée : ${place}`, `Reported area: ${place}`)}>
      <span className="corner" />
      <header className="inspector-head">
        <div className="min-w-0">
          <p className="section-title">{tr(locale, "Zone signalée", "Reported area")}</p>
          <h2 className="break-words text-[17px] font-light text-[#eaf6ff]">{place}</h2>
          <p className="meta">
            {selected.country ? `${selected.country} · ` : ""}
            {precisionLabel(clusterPrecision(selected), locale) ?? coords(lat, lon)}
          </p>
        </div>
        <button type="button" className="chip" onClick={() => void select(null)} aria-label={tr(locale, "Fermer la zone", "Close area")}>
          ✕
        </button>
      </header>
      <div className="inspector-body scroll-thin">
        <p className="text-[13px] text-[#cfe6f5]">{clusterSummary(selected, locale)}</p>
        <dl className="kv mt-2">
          <dt>{tr(locale, "Premier enregistrement", "First record")}</dt>
          <dd>{absoluteDateTime(selected.firstEventAt, locale)}</dd>
          <dt>{tr(locale, "Dernier enregistrement", "Latest record")}</dt>
          <dd>
            {absoluteDateTime(selected.lastEventAt, locale)} · {relativeTime(selected.lastEventAt, locale, now)}
          </dd>
          <dt>{tr(locale, "Bilan humain", "Casualties")}</dt>
          <dd>
            {b.fatalities !== null
              ? `${int(b.fatalities)} ${tr(locale, "morts rapportés par la source (incidents vérifiés)", "deaths reported by the source (verified incidents)")}`
              : tr(locale, "Sans objet : articles de presse et détections ne comptent pas de victimes", "Not applicable: press articles and detections carry no casualty count")}
          </dd>
        </dl>
        {b.press ? (
          <p className="feed-caveat mt-2 block">
            {tr(locale, "Un article de presse signale un sujet, il ne confirme pas un fait. Un article citant plusieurs lieux compte une fois par lieu.", "A press article signals a topic, it does not confirm a fact. An article citing several places counts once per place.")}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <a className="chip" href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=10/${lat}/${lon}`} target="_blank" rel="noopener noreferrer">
            {tr(locale, "Carte OSM ↗", "OSM map ↗")}
          </a>
          <a className="chip" href={`https://www.google.com/maps/@${lat},${lon},12z/data=!3m1!1e3`} target="_blank" rel="noopener noreferrer">
            {tr(locale, "Vue satellite ↗", "Satellite view ↗")}
          </a>
        </div>

        <div className="mt-3 flex items-baseline justify-between">
          <h3 className="section-title">{tr(locale, "Enregistrements", "Records")}</h3>
          <span className="meta">{selecting ? tr(locale, "chargement…", "loading…") : `${events.length} / ${selected.eventCount}`}</span>
        </div>
        <ul className="mt-1.5 space-y-2">
          {events.map((e) => (
            <EventRow key={e.id} event={e} locale={locale} now={now} />
          ))}
        </ul>
        {!events.length && !selecting ? <p className="empty-line">{tr(locale, "Détail indisponible pour cette zone avec les filtres actuels.", "Details unavailable for this area with current filters.")}</p> : null}
      </div>
    </section>
  );
}
