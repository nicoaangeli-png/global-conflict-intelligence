"use client";

import type { LiveItem } from "@/types/feeds";
import { absoluteDateTime, relativeTime } from "@/lib/format";
import { tr, type Locale } from "@/lib/i18n";
import { useIntelStore } from "@/store/useIntelStore";
import { NATURE_LABELS, NATURE_TONE, THEME_COLORS, THEME_LABELS, isLive, itemTime, label } from "./feedModel";
import { countryLabel, useCountryReference } from "./countryReference";
import { formatDuration, trackPoints, vehicleFacts, vehicleHeading, vehicleOf } from "./vehicleModel";
import { CoverageLine } from "@/components/coverage/CoverageLine";
import { useSensorCoverage } from "@/components/coverage/useSensorCoverage";

export const VEHICLE_LABELS = { aircraft: { fr: "Avion", en: "Aircraft" }, vessel: { fr: "Navire", en: "Vessel" }, merchant: { fr: "Navire civil", en: "Civilian vessel" } } as const;

/** Bloc « mobile » du détail : identité publiée, altitude/vitesse, dernière position, trajet observé. */
function VehicleFacts({ item, locale, now }: { item: LiveItem; locale: Locale; now: number }) {
  const kind = vehicleOf(item);
  if (!kind) return null;
  const facts = vehicleFacts(item);
  const heading = vehicleHeading(item);
  const pts = trackPoints(item);
  const last = itemTime(item);
  const nf = (v: number) => v.toLocaleString(locale === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: 0 });
  return (
    <dl className="kv mt-3">
      <dt>{tr(locale, "Mobile", "Vehicle")}</dt>
      <dd>{label(VEHICLE_LABELS[kind], locale)}</dd>
      {facts.callsign ? (
        <>
          <dt>{tr(locale, "Indicatif", "Callsign")}</dt>
          <dd>{facts.callsign}</dd>
        </>
      ) : null}
      {facts.type ? (
        <>
          <dt>{tr(locale, "Type (code source)", "Type (source code)")}</dt>
          <dd>{facts.type}</dd>
        </>
      ) : null}
      {facts.registration ? (
        <>
          <dt>{tr(locale, "Immatriculation", "Registration")}</dt>
          <dd>{facts.registration}</dd>
        </>
      ) : null}
      {facts.altitudeFt !== null || facts.speedKt !== null ? (
        <>
          <dt>{tr(locale, "Altitude / vitesse", "Altitude / speed")}</dt>
          <dd>
            {facts.altitudeFt !== null ? `${nf(facts.altitudeFt)} ft` : tr(locale, "altitude non publiée", "altitude not published")} ·{" "}
            {facts.speedKt !== null ? `${nf(facts.speedKt)} kt` : tr(locale, "vitesse non publiée", "speed not published")}
          </dd>
        </>
      ) : null}
      {heading ? (
        <>
          <dt>{tr(locale, "Cap", "Heading")}</dt>
          <dd>
            {Math.round(heading.deg)}°{heading.from === "track" ? ` ${tr(locale, "(déduit des deux dernières positions)", "(from the last two positions)")}` : ""}
          </dd>
        </>
      ) : null}
      <dt>{tr(locale, "Dernière position", "Last position")}</dt>
      <dd>{last ? `${absoluteDateTime(last, locale)} · ${relativeTime(last, locale, now)}` : tr(locale, "non datée par la source", "not dated by the source")}</dd>
      <dt>{tr(locale, "Trajet observé", "Observed track")}</dt>
      <dd>
        {pts.length >= 2
          ? `${formatDuration(pts[pts.length - 1].t - pts[0].t, locale)} · ${pts.length} ${tr(locale, "positions", "positions")} (${tr(locale, "depuis", "since")} ${absoluteDateTime(new Date(pts[0].t).toISOString(), locale)})`
          : tr(locale, "pas encore de positions précédentes publiées", "no previous positions published yet")}
      </dd>
    </dl>
  );
}

/** Couverture du capteur autour de la position du mobile (avion → ADS-B, navire → AIS). */
function VehicleCoverage({ item, locale }: { item: LiveItem; locale: Locale }) {
  const kind = vehicleOf(item);
  const sensor = kind === "aircraft" ? "adsb" : kind ? "ais" : null;
  const point = item.lat !== null && item.lon !== null ? { lat: item.lat, lon: item.lon } : null;
  const coverage = useSensorCoverage(point, sensor !== null && point !== null);
  if (!sensor || !point) return null;
  return <CoverageLine sensor={sensor} zone coverage={coverage.data?.[sensor] ?? null} loading={coverage.status === "loading"} locale={locale} />;
}

/**
 * Briques d'affichage d'un élément de flux : badge de nature, pastille DIRECT,
 * ligne du fil et détail. Toute date affichée est la date propre de l'élément
 * (événement ou publication), la date absolue apparaît au survol.
 */

export function NatureBadge({ item, locale }: { item: LiveItem; locale: Locale }) {
  const tone = NATURE_TONE[item.nature] ?? "neutral";
  return (
    <span className="nature-badge" data-tone={tone}>
      {label(NATURE_LABELS[item.nature] ?? { fr: item.nature, en: item.nature }, locale)}
    </span>
  );
}

export function LivePill({ locale }: { locale: Locale }) {
  return (
    <span className="live-pill" title={tr(locale, "Élément daté de moins de 2 heures", "Item dated less than 2 hours ago")}>
      <span className="live-pill-dot" />
      {tr(locale, "DIRECT", "LIVE")}
    </span>
  );
}

export function CategoryTag({ item, locale }: { item: LiveItem; locale: Locale }) {
  const color = THEME_COLORS[item.category];
  return (
    <span className="category-tag" style={{ color }}>
      <span className="category-dot" style={{ background: color }} />
      {label(THEME_LABELS[item.category], locale)}
    </span>
  );
}

/** Heure relative + date absolue au survol (jamais la date de collecte). */
export function ItemTime({ item, locale, now }: { item: LiveItem; locale: Locale; now: number }) {
  const iso = itemTime(item);
  if (!iso) return <span className="meta" title={tr(locale, "La source ne fournit pas de date", "The source gives no date")}>{tr(locale, "date non fournie", "no date given")}</span>;
  return (
    <time className="meta whitespace-nowrap" dateTime={iso} title={absoluteDateTime(iso, locale)}>
      {relativeTime(iso, locale, now)}
    </time>
  );
}

function Metric({ item }: { item: LiveItem }) {
  if (!item.metric) return null;
  const { value, unit, label: metricLabel } = item.metric;
  // Signe et couleur seulement pour une variation de cotation : une « baisse de connectivité
  // de 1,4 % » n'est pas une hausse verte.
  const quote = item.nature === "market_quote" && unit === "%";
  const number = value.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  const signed = quote ? `${value > 0 ? "+" : ""}${number} %` : `${number}${unit ? ` ${unit}` : ""}`;
  const tone = quote ? (value > 0 ? "up" : value < 0 ? "down" : "flat") : "flat";
  return (
    <span className="metric" data-tone={tone} title={metricLabel}>
      {signed}
    </span>
  );
}

export function FeedItemRow({ item, locale, now, showCategory, hideCaveat = false }: { item: LiveItem; locale: Locale; now: number; showCategory: boolean; hideCaveat?: boolean }) {
  const selectFeedItem = useIntelStore((s) => s.selectFeedItem);
  const selectedId = useIntelStore((s) => s.selectedFeedItem?.id ?? null);
  const hoverFeed = useIntelStore((s) => s.hoverFeed);
  const { ref } = useCountryReference();
  const countries = item.countries.slice(0, 3).map((iso) => countryLabel(iso, ref, locale));
  // Une position d'aéronef est par nature récente : pas de pastille DIRECT sur chaque ligne.
  const live = isLive(item, now) && item.category !== "military";

  return (
    <li className="feed-row" data-active={selectedId === item.id}>
      <button
        type="button"
        className="feed-row-main"
        onClick={() => selectFeedItem(selectedId === item.id ? null : item)}
        onMouseEnter={() => hoverFeed(item.id)}
        onMouseLeave={() => hoverFeed(null)}
        aria-label={`${item.title} — ${tr(locale, "afficher le détail", "show details")}`}
      >
        <span className="flex flex-wrap items-center gap-1.5">
          {live ? <LivePill locale={locale} /> : null}
          {showCategory ? <CategoryTag item={item} locale={locale} /> : null}
          {vehicleOf(item) ? <span className="category-tag text-[#cfe6f5]">{label(VEHICLE_LABELS[vehicleOf(item)!], locale)}</span> : null}
          <NatureBadge item={item} locale={locale} />
          <Metric item={item} />
        </span>
        <span className="feed-title">{item.title}</span>
        <span className="feed-meta">
          <span>{item.sourceName}</span>
          {countries.length ? (
            <span>
              · {countries.join(", ")}
              {item.countries.length > 3 ? ` +${item.countries.length - 3}` : ""}
            </span>
          ) : null}
          <span className="ml-auto shrink-0">
            <ItemTime item={item} locale={locale} now={now} />
          </span>
        </span>
        {item.caveat && !hideCaveat ? <span className="feed-caveat">{item.caveat}</span> : null}
      </button>
      {item.url ? (
        <a className="feed-link" href={item.url} target="_blank" rel="noopener noreferrer" title={tr(locale, "Ouvrir la source d'origine", "Open the original source")}>
          {tr(locale, "Source ↗", "Source ↗")}
        </a>
      ) : null}
    </li>
  );
}

/** Détail complet d'un élément (inspecteur de droite). */
export function FeedItemDetail({ item, locale, now }: { item: LiveItem; locale: Locale; now: number }) {
  const selectFeedItem = useIntelStore((s) => s.selectFeedItem);
  const setCountry = useIntelStore((s) => s.setCountry);
  const focus = useIntelStore((s) => s.focus);
  const { ref } = useCountryReference();
  const iso = itemTime(item);

  return (
    <section className="panel corners boot inspector" aria-label={tr(locale, "Détail de l'élément", "Item details")}>
      <span className="corner" />
      <header className="inspector-head">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {isLive(item, now) ? <LivePill locale={locale} /> : null}
          <CategoryTag item={item} locale={locale} />
          <NatureBadge item={item} locale={locale} />
        </div>
        <button type="button" className="chip" onClick={() => selectFeedItem(null)} aria-label={tr(locale, "Fermer le détail", "Close details")}>
          ✕
        </button>
      </header>
      <div className="inspector-body scroll-thin">
        <h2 className="text-[15px] font-light leading-snug text-[#eaf6ff]">{item.title}</h2>
        {item.summary ? <p className="mt-2 text-[12px] leading-relaxed text-[#b6d3e6]">{item.summary}</p> : null}
        <VehicleFacts item={item} locale={locale} now={now} />
        <VehicleCoverage item={item} locale={locale} />
        {item.caveat ? <p className="feed-caveat mt-3 block">{item.caveat}</p> : null}
        <dl className="kv mt-3">
          <dt>{tr(locale, "Source", "Source")}</dt>
          <dd>{item.sourceName}</dd>
          <dt>{item.occurredAt ? tr(locale, "Date de l'événement", "Event date") : tr(locale, "Date de publication", "Publication date")}</dt>
          <dd>{iso ? `${absoluteDateTime(iso, locale)} · ${relativeTime(iso, locale, now)}` : tr(locale, "non fournie par la source", "not given by the source")}</dd>
          {item.occurredAt && item.publishedAt && item.publishedAt !== item.occurredAt ? (
            <>
              <dt>{tr(locale, "Publié", "Published")}</dt>
              <dd>{absoluteDateTime(item.publishedAt, locale)}</dd>
            </>
          ) : null}
          <dt>{tr(locale, "Collecté par ORBITAL", "Collected by ORBITAL")}</dt>
          <dd>{absoluteDateTime(item.fetchedAt, locale)}</dd>
          {item.metric && !vehicleOf(item) ? (
            <>
              <dt>{item.metric.label}</dt>
              <dd>
                {item.metric.value.toLocaleString(locale === "fr" ? "fr-FR" : "en-US")}
                {item.metric.unit ? ` ${item.metric.unit}` : ""}
              </dd>
            </>
          ) : null}
          {item.lat !== null && item.lon !== null ? (
            <>
              <dt>{tr(locale, "Position", "Position")}</dt>
              <dd>
                {item.lat.toFixed(2)}°, {item.lon.toFixed(2)}°
              </dd>
            </>
          ) : null}
        </dl>
        {item.countries.length ? (
          <div className="mt-3">
            <div className="section-title">{tr(locale, "Pays concernés", "Countries")}</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {item.countries.map((code) => {
                const entry = ref?.get(code);
                return (
                  <button
                    key={code}
                    type="button"
                    className="chip"
                    disabled={!entry?.center}
                    title={entry?.center ? tr(locale, "Ouvrir la fiche pays", "Open country profile") : tr(locale, "Pays absent du référentiel cartographique", "Country missing from map reference")}
                    onClick={() => {
                      if (!entry?.center) return;
                      setCountry({ name: entry.name, iso: code, lat: entry.center.lat, lon: entry.center.lon, source: "explorer" });
                      focus(entry.center.lat, entry.center.lon);
                    }}
                  >
                    {countryLabel(code, ref, locale)}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {item.url ? (
          <a className="action-button mt-4" href={item.url} target="_blank" rel="noopener noreferrer">
            {tr(locale, "Lire à la source ↗", "Read at the source ↗")}
          </a>
        ) : (
          <p className="meta mt-4">{tr(locale, "La source ne fournit pas de lien direct.", "The source provides no direct link.")}</p>
        )}
      </div>
    </section>
  );
}
