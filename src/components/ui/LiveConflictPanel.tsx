"use client";

import { coords, compact, dateTimeUTC, int, relative } from "@/lib/format";
import { useIntelStore } from "@/store/useIntelStore";
import type { Confidence, ConflictEvent } from "@/types/conflict";

/**
 * Panneau « LIVE CONFLICT DATA » + bloc « EVENT DETAILS ».
 *
 * Règle éditoriale appliquée à la lettre : chaque donnée affichée porte sa
 * source, sa date de dernière mise à jour et son niveau de confiance. Rien
 * n'est déduit, rien n'est extrapolé.
 */

const CONFIDENCE_META: Record<Confidence, { label: string; color: string }> = {
  CONFIRMED: { label: "Donnée confirmée", color: "#7fd4ff" },
  REPORTED: { label: "Événement rapporté", color: "#9fd8c0" },
  MEDIA_SIGNAL: { label: "Signal presse", color: "#ffb066" },
  DEMO: { label: "Jeu de démonstration", color: "#c9a0ff" },
};

function Field({ label, value, mono, hint }: { label: string; value: string; mono?: boolean; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[5px]">
      <span className="label shrink-0">{label}</span>
      <span className="flex flex-col items-end">
        <span className={`${mono ? "readout" : "text-[11px] font-light text-text"} text-right`}>{value}</span>
        {hint ? <span className="readout text-[9px] text-text-faint">{hint}</span> : null}
      </span>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const meta = CONFIDENCE_META[confidence] ?? CONFIDENCE_META.DEMO;
  return (
    <span
      className="inline-flex items-center gap-[5px] border px-[6px] py-[2px]"
      style={{ borderColor: `${meta.color}55`, background: `${meta.color}12`, color: meta.color }}
    >
      <span className="dot" style={{ color: meta.color }} />
      <span className="text-[8px] uppercase tracking-[0.18em]">{meta.label}</span>
    </span>
  );
}

function EventRow({ event }: { event: ConflictEvent }) {
  const meta = CONFIDENCE_META[event.confidence] ?? CONFIDENCE_META.DEMO;
  return (
    <div className="border-l border-[rgba(127,212,255,0.12)] py-[5px] pl-[9px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] font-light tracking-wide text-text">{event.eventType}</span>
        <span className="readout text-[9px]">{event.fatalities > 0 ? `${event.fatalities} †` : "0 †"}</span>
      </div>
      <div className="mt-[2px] flex items-baseline justify-between gap-3">
        <span className="truncate text-[9px] tracking-[0.06em] text-text-faint">
          {event.subEventType || event.eventType}
        </span>
        <span className="readout text-[9px] text-text-faint">{dateTimeUTC(event.eventDate)}</span>
      </div>
      <div className="mt-[3px] flex items-center justify-between gap-2">
        <span className="truncate text-[9px] text-text-faint">
          {event.actors.length ? event.actors.join(" ↔ ") : "acteurs non précisés"}
        </span>
        <span className="shrink-0 text-[8px] uppercase tracking-[0.16em]" style={{ color: meta.color }}>
          {event.confidence === "MEDIA_SIGNAL" ? "SIGNAL" : event.confidence}
        </span>
      </div>
      {event.source ? (
        <div className="mt-[2px] truncate text-[8px] uppercase tracking-[0.14em] text-text-faint">
          {event.sourceUrl ? (
            <a
              href={event.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-dotted hover:text-cyan"
            >
              {event.source}
            </a>
          ) : (
            event.source
          )}
        </div>
      ) : null}
    </div>
  );
}

export function LiveConflictPanel() {
  const selected = useIntelStore((s) => s.selected);
  const events = useIntelStore((s) => s.selectedEvents);
  const selecting = useIntelStore((s) => s.selecting);
  const clusters = useIntelStore((s) => s.clusters);
  const select = useIntelStore((s) => s.select);

  const fatalities = events.reduce((a, e) => a + e.fatalities, 0);
  const actors = [...new Set(events.flatMap((e) => e.actors))].slice(0, 6);
  const sources = [...new Set(events.map((e) => e.source).filter(Boolean))].slice(0, 3);
  const lastEvent = events[0];

  return (
    <section className="panel corners boot flex max-h-[calc(100vh-260px)] w-[300px] flex-col">
      <span className="corner" />
      <div className="flex items-center justify-between px-3 pt-[10px]">
        <span className="label-strong">Live Conflict Data</span>
        <span className="readout text-[9px]">{selected ? "FOYER SÉLECTIONNÉ" : "FLUX"}</span>
      </div>
      <div className="hairline mx-3 mt-2" />

      {selected ? (
        <>
          <div className="px-3 pt-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] font-extralight tracking-[0.12em] text-ice">
                {(selected.country || "—").toUpperCase()}
              </span>
              <button
                type="button"
                className="chip"
                onClick={() => void select(null)}
                style={{ padding: "2px 6px" }}
              >
                fermer
              </button>
            </div>
            {selected.locality ? (
              <div className="mt-[2px] text-[10px] uppercase tracking-[0.2em] text-text-dim">{selected.locality}</div>
            ) : null}
            <div className="mt-2 flex items-center gap-2">
              <ConfidenceBadge confidence={selected.confidence} />
              <span className="readout text-[9px]">{coords(selected.latitude, selected.longitude)}</span>
            </div>
          </div>

          <div className="mt-2 px-3">
            <Field label="Événements" value={int(selected.eventCount)} mono />
            <div className="hairline" />
            <Field label="Victimes déclarées" value={`${int(selected.fatalities)} †`} mono />
            <div className="hairline" />
            <Field label="Type dominant" value={selected.topType} />
            <div className="hairline" />
            <Field label="Premier événement" value={dateTimeUTC(selected.firstEventAt)} mono />
            <div className="hairline" />
            <Field label="Dernier événement" value={dateTimeUTC(selected.lastEventAt)} mono hint={relative(selected.lastEventAt)} />
            <div className="hairline" />
            <Field label="Acteurs" value={actors.length ? actors.join(", ") : "non précisés"} />
            <div className="hairline" />
            <Field label="Sources" value={sources.length ? sources.join(" · ") : "—"} />
            <div className="hairline" />
            <Field
              label="Dernière MAJ"
              value={relative(lastEvent?.updatedAt ?? selected.lastEventAt)}
              mono
            />
          </div>

          <div className="hairline mx-3 mt-3" />
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="label-strong">Event details</span>
            <span className="readout text-[9px]">
              {selecting ? "CHARGEMENT…" : `${events.length} / ${selected.eventCount}`}
            </span>
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto px-3 pb-3 pt-1">
            {events.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
            {!events.length && !selecting ? (
              <div className="py-3 text-[10px] text-text-faint">aucun détail disponible</div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="px-3 pt-3">
            <p className="text-[10px] leading-relaxed text-text-dim">
              Sélectionnez un foyer sur le globe — ou dans la liste ci-dessous — pour ouvrir le détail des événements.
            </p>
          </div>
          <div className="hairline mx-3 mt-3" />
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="label-strong">Foyers détectés</span>
            <span className="readout text-[9px]">{clusters.length}</span>
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto pb-3 pt-1">
            {clusters.slice(0, 14).map((c) => (
              <button
                key={c.id}
                type="button"
                className="row-button flex items-center justify-between gap-3"
                onClick={() => void select(c)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-light text-text">
                    {c.locality || c.region || c.country || "—"}
                  </span>
                  <span className="block truncate text-[9px] uppercase tracking-[0.16em] text-text-faint">
                    {c.country} · {c.topType}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="value block text-[12px]">{compact(c.fatalities)}</span>
                  <span className="label block text-[8px]">† {c.eventCount} év.</span>
                  <span className="readout block text-[8px] text-text-faint">
                    {coords(c.latitude, c.longitude)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="hairline mx-3" />
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="label shrink-0">Fiabilité</span>
        <span className="readout text-right text-[8px] leading-relaxed text-text-faint">
          source · date · confiance — jamais de position tactique exacte
        </span>
      </div>
    </section>
  );
}
