"use client";

import { coords, compact, dateTimeUTC, int, relative } from "@/lib/format";
import { useIntelStore } from "@/store/useIntelStore";
import { getCountryGeopolitics } from "@/data/geopolitics";
import { t } from "@/lib/i18n";
import type { Confidence, ConflictEvent } from "@/types/conflict";

/**
 * Panneau « LIVE CONFLICT DATA » + bloc « EVENT DETAILS ».
 * Chaque donnée affichée porte sa source, sa date et sa confiance.
 * Intégration reconnaissance satellite & street view + géopolitique du pays.
 */

const CONFIDENCE_META = (locale: "fr" | "en"): Record<Confidence, { label: string; color: string }> => ({
  CONFIRMED: { label: locale === "fr" ? "Donnée confirmée" : "Confirmed data", color: "#7fd4ff" },
  REPORTED: { label: locale === "fr" ? "Événement rapporté" : "Reported incident", color: "#9fd8c0" },
  MEDIA_SIGNAL: { label: locale === "fr" ? "Signal presse" : "Media signal", color: "#ffb066" },
  DEMO: { label: locale === "fr" ? "Jeu de démonstration" : "Demo seed data", color: "#c9a0ff" },
});

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

function ConfidenceBadge({ confidence, locale }: { confidence: Confidence; locale: "fr" | "en" }) {
  const meta = CONFIDENCE_META(locale)[confidence] ?? CONFIDENCE_META(locale).DEMO;
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

function EventRow({ event, locale }: { event: ConflictEvent; locale: "fr" | "en" }) {
  const meta = CONFIDENCE_META(locale)[event.confidence] ?? CONFIDENCE_META(locale).DEMO;
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
          {event.actors.length ? event.actors.join(" ↔ ") : locale === "fr" ? "acteurs non précisés" : "unspecified actors"}
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
  const setReconTarget = useIntelStore((s) => s.setReconTarget);
  const locale = useIntelStore((s) => s.locale);

  const dict = t(locale);
  const geo = selected ? getCountryGeopolitics(selected.country) : null;

  const actors = [...new Set(events.flatMap((e) => e.actors))].slice(0, 6);
  const sources = [...new Set(events.map((e) => e.source).filter(Boolean))].slice(0, 3);
  const lastEvent = events[0];

  return (
    <section className="panel corners boot flex max-h-[calc(100vh-260px)] w-[300px] flex-col">
      <span className="corner" />
      <div className="flex items-center justify-between px-3 pt-[10px]">
        <span className="label-strong">{dict.liveConflict.title}</span>
        <span className="readout text-[9px]">
          {selected ? (locale === "fr" ? "FOYER SÉLECTIONNÉ" : "SELECTED HOTSPOT") : (locale === "fr" ? "FLUX" : "FEED")}
        </span>
      </div>
      <div className="hairline mx-3 mt-2" />

      {selected && geo ? (
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
                {dict.system.close}
              </button>
            </div>
            {selected.locality ? (
              <div className="mt-[2px] text-[10px] uppercase tracking-[0.2em] text-text-dim">{selected.locality}</div>
            ) : null}

            {/* Régime du pays hôte */}
            <div className="mt-2 border border-cyan/20 bg-cyan/5 p-1.5 text-[9px]">
              <span className="label text-cyan block">{dict.countryCard.regime} :</span>
              <span className="font-mono text-ice block">
                {locale === "fr" ? geo.regime.labelFr : geo.regime.labelEn}
              </span>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2">
              <ConfidenceBadge confidence={selected.confidence} locale={locale} />
              <span className="readout text-[9px]">{coords(selected.latitude, selected.longitude)}</span>
            </div>

            {/* Bouton Reconnaissance Urbaine & Street View */}
            <button
              type="button"
              className="chip mt-2.5 w-full border-cyan/50 bg-cyan/15 text-cyan hover:bg-cyan/25 py-1 text-[9px] font-mono tracking-wider flex items-center justify-center gap-1.5"
              onClick={() => {
                setReconTarget({
                  locality: selected.locality || selected.country,
                  country: selected.country,
                  lat: selected.latitude,
                  lon: selected.longitude,
                });
              }}
            >
              <span>🛰️</span>
              <span>{dict.liveConflict.reconButton}</span>
            </button>
          </div>

          <div className="mt-2 px-3">
            <Field label={dict.liveConflict.events} value={int(selected.eventCount)} mono />
            <div className="hairline" />
            <Field label={dict.liveConflict.fatalities} value={`${int(selected.fatalities)} †`} mono />
            <div className="hairline" />
            <Field label={dict.liveConflict.dominantType} value={selected.topType} />
            <div className="hairline" />
            <Field label={dict.liveConflict.firstEvent} value={dateTimeUTC(selected.firstEventAt)} mono />
            <div className="hairline" />
            <Field label={dict.liveConflict.lastEvent} value={dateTimeUTC(selected.lastEventAt)} mono hint={relative(selected.lastEventAt)} />
            <div className="hairline" />
            <Field label={dict.liveConflict.actors} value={actors.length ? actors.join(", ") : (locale === "fr" ? "non précisés" : "unspecified")} />
            <div className="hairline" />
            <Field label={dict.liveConflict.sources} value={sources.length ? sources.join(" · ") : "—"} />
            <div className="hairline" />
            <Field
              label={dict.liveConflict.lastUpdate}
              value={relative(lastEvent?.updatedAt ?? selected.lastEventAt)}
              mono
            />
          </div>

          <div className="hairline mx-3 mt-3" />
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="label-strong">{dict.liveConflict.eventDetails}</span>
            <span className="readout text-[9px]">
              {selecting ? dict.system.loading : `${events.length} / ${selected.eventCount}`}
            </span>
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto px-3 pb-3 pt-1">
            {events.map((e) => (
              <EventRow key={e.id} event={e} locale={locale} />
            ))}
            {!events.length && !selecting ? (
              <div className="py-3 text-[10px] text-text-faint">{dict.liveConflict.noDetails}</div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="px-3 pt-3">
            <p className="text-[10px] leading-relaxed text-text-dim">
              {dict.liveConflict.selectPrompt}
            </p>
          </div>
          <div className="hairline mx-3 mt-3" />
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="label-strong">{dict.liveConflict.detectedClusters}</span>
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
                  <span className="label block text-[8px]">† {c.eventCount} {locale === "fr" ? "év." : "ev."}</span>
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
        <span className="label shrink-0">{locale === "fr" ? "Fiabilité" : "Reliability"}</span>
        <span className="readout text-right text-[8px] leading-relaxed text-text-faint">
          {dict.liveConflict.reliabilityNotice}
        </span>
      </div>
    </section>
  );
}
