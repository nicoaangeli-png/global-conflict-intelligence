"use client";

import { useEffect, useMemo, useState } from "react";
import type { CountryIndicators } from "@/server/countryIndicators";
import type { FeedsResponse, LiveItem } from "@/types/feeds";
import { TIME_RANGES } from "@/types/conflict";
import { absoluteDateTime, int, relativeTime } from "@/lib/format";
import { tr, type Locale } from "@/lib/i18n";
import { resolveCountryIdentity, countryNamesMatchWhenIsoUnknown } from "@/lib/geo/country";
import { useIntelStore } from "@/store/useIntelStore";
import { countryLabel, useCountryReference } from "./countryReference";
import { clusterBreakdown } from "./conflictModel";
import { MILITARY_NOW_MS, THEME_COLORS, THEME_LABELS, countryMarkets, countrySections, flagEmoji, isLive, itemTime, label, militaryNow, type CountrySectionKey } from "./feedModel";
import type { LayerFeature, LayerId } from "@/types/layers";
import { LAYER_STYLE, featuresInCountry, sanctionsByCountry } from "@/components/layers/layerModel";
import { ItemTime, LivePill, NatureBadge } from "./FeedItem";
import { useNow } from "./useNow";

/**
 * FICHE PAYS UNIQUE (au clic sur un pays, ou depuis la recherche / un élément).
 *
 * Chaque section n'affiche que des données sourcées ; une section vide dit
 * « Rien dans nos sources sur 24 h », jamais « Inconnu », « N/A » ni « stable ».
 */

type Load<T> = { status: "loading" | "ready" | "error"; data: T | null };

const EMPTY_24H = { fr: "Rien dans nos sources sur 24 h.", en: "Nothing in our sources over 24 h." };

function Section({ title, color, children }: { title: string; color?: string; children: React.ReactNode }) {
  return (
    <section className="fiche-section">
      <h3 className="section-title flex items-center gap-2">
        {color ? <span className="category-dot" style={{ background: color }} /> : null}
        {title}
      </h3>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

function MiniItem({ item, locale, now, hideCaveat = false }: { item: LiveItem; locale: Locale; now: number; hideCaveat?: boolean }) {
  const selectFeedItem = useIntelStore((s) => s.selectFeedItem);
  return (
    <li className="mini-item">
      <div className="flex flex-wrap items-center gap-1.5">
        {isLive(item, now) && item.category !== "military" ? <LivePill locale={locale} /> : null}
        <NatureBadge item={item} locale={locale} />
        {item.metric && item.category === "military" ? <span className="metric">{item.metric.value.toLocaleString("fr-FR")}{item.metric.unit ? ` ${item.metric.unit}` : ""}</span> : null}
      </div>
      <button type="button" className="mini-title" onClick={() => selectFeedItem(item)} title={tr(locale, "Afficher le détail", "Show details")}>
        {item.title}
      </button>
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <span className="meta min-w-0 flex-1">{item.sourceName}</span>
        <span className="shrink-0">
          <ItemTime item={item} locale={locale} now={now} />
        </span>
        {item.url ? (
          <a className="feed-link-inline" href={item.url} target="_blank" rel="noopener noreferrer">
            {tr(locale, "Source ↗", "Source ↗")}
          </a>
        ) : null}
      </div>
      {item.caveat && !hideCaveat ? <p className="feed-caveat">{item.caveat}</p> : null}
    </li>
  );
}

function FeedSection({
  sectionKey,
  data,
  locale,
  now,
  status,
  title,
}: {
  sectionKey: CountrySectionKey;
  data: { recent: LiveItem[]; older: LiveItem | null };
  locale: Locale;
  now: number;
  status: Load<unknown>["status"];
  title?: string;
}) {
  const shown = data.recent.slice(0, 5);
  return (
    <Section title={title ?? label(THEME_LABELS[sectionKey], locale)} color={THEME_COLORS[sectionKey]}>
      {data.recent.length ? (
        <ul className="space-y-2">
          {shown.map((item, i) => (
            // Un avertissement identique au précédent n'est pas répété.
            <MiniItem key={item.id} item={item} locale={locale} now={now} hideCaveat={shown.slice(0, i).some((prev) => prev.caveat === item.caveat)} />
          ))}
          {data.recent.length > 5 ? <li className="meta">+ {data.recent.length - 5} {tr(locale, "autres sur 24 h", "more over 24 h")}</li> : null}
        </ul>
      ) : status === "loading" ? (
        <p className="meta">{tr(locale, "Chargement…", "Loading…")}</p>
      ) : (
        <>
          <p className="empty-line">{label(EMPTY_24H, locale)}</p>
          {data.older ? (
            <p className="meta mt-1">
              {tr(locale, "Plus ancien", "Older")} ({relativeTime(itemTime(data.older), locale, now)}) :{" "}
              <button type="button" className="link-button" onClick={() => useIntelStore.getState().selectFeedItem(data.older)}>
                {data.older.title}
              </button>
            </p>
          ) : null}
        </>
      )}
    </Section>
  );
}

/** Liste repliable des installations connues d'un calque (centrales, bases) pour un pays. */
function FacilityList({ layerId, features, locale, status }: { layerId: LayerId; features: LayerFeature[]; locale: Locale; status: "loading" | "ready" | "error" | "source-error" }) {
  const selectLayerFeature = useIntelStore((s) => s.selectLayerFeature);
  const toggleLayer = useIntelStore((s) => s.toggleLayer);
  const style = LAYER_STYLE[layerId];
  const name = style.label[locale];
  if (status === "loading") return <p className="meta">{name} : {tr(locale, "source en cours de chargement…", "source loading…")}</p>;
  if (status === "error" || status === "source-error") return <p className="meta">{name} : {tr(locale, "source indisponible pour le moment.", "source unavailable right now.")}</p>;
  if (!features.length) return <p className="empty-line">{name} : {tr(locale, "rien dans nos sources.", "nothing in our sources.")}</p>;
  return (
    <details className="facility-list">
      <summary>
        <span className="text-[#e3f3ff]">{name}</span> · {int(features.length)} {tr(locale, "connue(s)", "known")}
      </summary>
      <ul className="mt-1.5 space-y-1">
        {features.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              className="link-button text-[12px]"
              onClick={() => {
                // Le calque s'allume pour montrer l'élément sur le globe.
                if (!useIntelStore.getState().layersOn[layerId]) toggleLayer(layerId);
                selectLayerFeature({ layerId, feature: f });
              }}
            >
              {f.name}
            </button>
            {typeof f.properties.status === "string" ? <span className="meta"> · {f.properties.status}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function CountryPanel() {
  const country = useIntelStore((s) => s.country);
  const locale = useIntelStore((s) => s.locale);
  const clusters = useIntelStore((s) => s.clusters);
  const storeFeeds = useIntelStore((s) => s.feeds);
  const range = useIntelStore((s) => s.filters.range);
  const setCountry = useIntelStore((s) => s.setCountry);
  const select = useIntelStore((s) => s.select);
  const openAura = useIntelStore((s) => s.openAura);
  const layers = useIntelStore((s) => s.layers);
  const ensureLayer = useIntelStore((s) => s.ensureLayer);
  const { ref } = useCountryReference();
  const now = useNow();
  const iso = country ? (resolveCountryIdentity(country.iso || country.name)?.iso3 ?? country.iso) : "";
  const validIso = /^[A-Z]{3}$/.test(iso);

  const [countryFeeds, setCountryFeeds] = useState<Load<LiveItem[]>>({ status: "loading", data: null });
  const [indicators, setIndicators] = useState<Load<CountryIndicators>>({ status: "loading", data: null });

  // Flux du pays : une requête générale + une requête économie (les cotations ne sont jamais évincées).
  useEffect(() => {
    if (!validIso) {
      setCountryFeeds({ status: "error", data: null });
      return;
    }
    const controller = new AbortController();
    setCountryFeeds({ status: "loading", data: null });
    const get = (q: string) =>
      fetch(`/api/feeds?${q}`, { signal: controller.signal, cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<FeedsResponse>;
      });
    Promise.allSettled([get(`country=${iso}&limit=300`), get(`category=economy&country=${iso}&limit=50`)]).then((results) => {
      if (controller.signal.aborted) return;
      const items = new Map<string, LiveItem>();
      let ok = false;
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        ok = true;
        for (const item of r.value.items ?? []) items.set(item.id, item);
      }
      setCountryFeeds(ok ? { status: "ready", data: [...items.values()] } : { status: "error", data: null });
    });
    return () => controller.abort();
  }, [iso, validIso]);

  // Dirigeants (Wikidata) et indicateurs annuels (Banque mondiale), avec année.
  useEffect(() => {
    if (!validIso) {
      setIndicators({ status: "error", data: null });
      return;
    }
    const controller = new AbortController();
    setIndicators({ status: "loading", data: null });
    fetch(`/api/country?iso=${iso}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok && r.status !== 502) throw new Error(String(r.status));
        return r.json() as Promise<CountryIndicators>;
      })
      .then((data) => setIndicators({ status: "ready", data }))
      .catch(() => {
        if (!controller.signal.aborted) setIndicators({ status: "error", data: null });
      });
    return () => controller.abort();
  }, [iso, validIso]);

  // Calques de référence utiles à la fiche (chargés une fois pour la session, même éteints).
  useEffect(() => {
    if (!validIso) return;
    for (const id of ["sanctions", "nuclear_plants", "military_bases"] as const) void ensureLayer(id);
  }, [validIso, ensureLayer]);

  // Les éléments déjà chargés par le fil complètent la requête pays (même contrat).
  const items = useMemo(() => {
    const map = new Map<string, LiveItem>();
    for (const item of storeFeeds) if (item.countries.includes(iso)) map.set(item.id, item);
    for (const item of countryFeeds.data ?? []) map.set(item.id, item);
    return [...map.values()];
  }, [storeFeeds, countryFeeds.data, iso]);

  const sections = useMemo(() => countrySections(items, iso, now), [items, iso, now]);
  const markets = useMemo(() => countryMarkets(items, iso), [items, iso]);
  const aircraft = useMemo(() => militaryNow(items, iso, now), [items, iso, now]);
  const layerStatus = (id: LayerId) => {
    const l = layers[id];
    if (!l || l.status === "loading") return "loading" as const;
    if (l.status === "error" && !l.data) return "error" as const;
    if (l.data?.status === "error") return "source-error" as const;
    return "ready" as const;
  };
  const sanctionsData = layers.sanctions?.data ?? null;
  const sanctions = useMemo(() => (sanctionsData ? (sanctionsByCountry(sanctionsData.features).get(iso) ?? null) : null), [sanctionsData, iso]);
  const nuclearFeatures = useMemo(() => featuresInCountry(layers.nuclear_plants?.data?.features ?? [], iso), [layers.nuclear_plants?.data, iso]);
  const baseFeatures = useMemo(() => featuresInCountry(layers.military_bases?.data?.features ?? [], iso), [layers.military_bases?.data, iso]);

  const local = useMemo(
    () =>
      country
        ? clusters.filter((c) => {
            const clusterIso = resolveCountryIdentity(c.country)?.iso3;
            if (validIso && clusterIso) return clusterIso === iso;
            return countryNamesMatchWhenIsoUnknown(country.name, c.country);
          })
        : [],
    [clusters, country, iso, validIso],
  );

  if (!country) return null;

  const fr = locale === "fr";
  const name = validIso ? countryLabel(iso, ref, locale) : country.name;
  const flag = flagEmoji(ref?.get(iso)?.iso2);
  const totals = local.reduce(
    (acc, c) => {
      const b = clusterBreakdown(c);
      acc.press += b.press;
      acc.satellite += b.satellite;
      acc.verified += b.verified;
      acc.fatalities += b.fatalities ?? 0;
      return acc;
    },
    { press: 0, satellite: 0, verified: 0, fatalities: 0 },
  );
  const hottest = [...local].sort((a, b) => b.eventCount - a.eventCount)[0];
  const rangeLabel = (TIME_RANGES.find((r) => r.key === range)?.label ?? range).toLowerCase();
  const leaders = indicators.data?.leaders;
  const feedStatus = countryFeeds.status === "error" && !items.length ? "error" : countryFeeds.status;

  return (
    <section className="panel corners boot inspector" aria-label={tr(locale, `Fiche pays : ${name}`, `Country profile: ${name}`)}>
      <span className="corner" />
      <header className="inspector-head">
        <div className="flex min-w-0 items-center gap-2.5">
          {flag ? (
            <span className="text-[24px] leading-none" aria-hidden>
              {flag}
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="break-words text-[17px] font-light tracking-wide text-[#eaf6ff]">{name}</h2>
            <p className="meta">
              {validIso ? iso : tr(locale, "code pays non résolu", "unresolved country code")}
            </p>
          </div>
        </div>
        <button type="button" className="chip" onClick={() => setCountry(null)} aria-label={tr(locale, "Fermer la fiche pays", "Close country profile")}>
          ✕
        </button>
      </header>

      <div className="inspector-body scroll-thin">
        <button
          type="button"
          className="action-button"
          onClick={() => openAura(fr ? `Fais le point sur la situation actuelle du pays suivant : ${name}. Cite tes sources.` : `Give me the current situation in this country: ${name}. Cite your sources.`)}
        >
          ✦ {tr(locale, "Approfondir avec AURA", "Dig deeper with AURA")}
        </button>

        {feedStatus === "error" ? (
          <p className="error-note mt-3">{tr(locale, "Flux du pays indisponibles : le service des flux n'a pas répondu.", "Country feeds unavailable: the feed service did not respond.")}</p>
        ) : null}

        <Section title={tr(locale, "Conflit", "Conflict")} color={THEME_COLORS.conflict}>
          {local.length ? (
            <>
              <dl className="kv">
                {totals.verified ? (
                  <>
                    <dt>{tr(locale, "Incidents vérifiés", "Verified incidents")}</dt>
                    <dd>
                      {int(totals.verified)}
                      {totals.fatalities ? ` · ${int(totals.fatalities)} ${tr(locale, "morts (source)", "deaths (source)")}` : ""}
                    </dd>
                  </>
                ) : null}
                {totals.press ? (
                  <>
                    <dt>{tr(locale, "Articles de presse", "Press articles")}</dt>
                    <dd>{int(totals.press)} · {tr(locale, "non confirmés", "unconfirmed")}</dd>
                  </>
                ) : null}
                {totals.satellite ? (
                  <>
                    <dt>{tr(locale, "Détections satellite", "Satellite detections")}</dt>
                    <dd>{int(totals.satellite)} · {tr(locale, "anomalies thermiques", "thermal anomalies")}</dd>
                  </>
                ) : null}
              </dl>
              <p className="meta mt-1">
                {tr(locale, `Période : ${rangeLabel} · ${local.length} zone(s) signalée(s). Jamais additionnés.`, `Period: ${rangeLabel} · ${local.length} reported area(s). Never summed.`)}
              </p>
              {hottest ? (
                <button type="button" className="chip mt-2" onClick={() => void select(hottest)}>
                  {tr(locale, "Voir la zone la plus citée", "Open the most reported area")} : {hottest.locality || hottest.region || hottest.country}
                </button>
              ) : null}
            </>
          ) : (
            <p className="empty-line">{tr(locale, `Rien dans nos sources de conflit sur ${rangeLabel}.`, `Nothing in our conflict sources over ${rangeLabel}.`)}</p>
          )}
        </Section>

        <Section title={tr(locale, "Activité militaire observée", "Observed military activity")} color={THEME_COLORS.military}>
          {aircraft.length ? (
            <>
              <p className="meta">
                {tr(locale, `${aircraft.length} aéronef(s) militaire(s) à position publiée au-dessus du pays (dernière heure)`, `${aircraft.length} military aircraft with a published position over the country (last hour)`)}
              </p>
              <ul className="mt-1.5 space-y-2">
                {aircraft.slice(0, 5).map((item, i) => (
                  <MiniItem key={item.id} item={item} locale={locale} now={now} hideCaveat={i > 0} />
                ))}
                {aircraft.length > 5 ? <li className="meta">+ {aircraft.length - 5} {tr(locale, "autres (onglet Militaire)", "more (Military tab)")}</li> : null}
              </ul>
            </>
          ) : feedStatus === "loading" ? (
            <p className="meta">{tr(locale, "Chargement…", "Loading…")}</p>
          ) : (
            <p className="empty-line">
              {tr(
                locale,
                `Rien dans nos sources sur ${Math.round(MILITARY_NOW_MS / 60e3)} min : aucun aéronef militaire à position ADS-B publiée au-dessus du pays (beaucoup n'émettent pas).`,
                `Nothing in our sources over ${Math.round(MILITARY_NOW_MS / 60e3)} min: no military aircraft with a published ADS-B position over the country (many do not transmit).`,
              )}
            </p>
          )}
        </Section>

        <FeedSection sectionKey="social" data={sections.social} locale={locale} now={now} status={feedStatus} />
        <FeedSection sectionKey="disaster" data={sections.disaster} locale={locale} now={now} status={feedStatus} />
        <FeedSection sectionKey="weather" title={tr(locale, "Alertes météo officielles", "Official weather alerts")} data={sections.weather} locale={locale} now={now} status={feedStatus} />
        <FeedSection sectionKey="infrastructure" title={tr(locale, "Pannes internet et ports", "Internet outages and ports")} data={sections.infrastructure} locale={locale} now={now} status={feedStatus} />
        <FeedSection sectionKey="health" data={sections.health} locale={locale} now={now} status={feedStatus} />
        <FeedSection sectionKey="un" data={sections.un} locale={locale} now={now} status={feedStatus} />

        <Section title={tr(locale, "Sanctions OFAC (États-Unis)", "OFAC sanctions (United States)")} color={LAYER_STYLE.sanctions.color}>
          {layerStatus("sanctions") === "loading" ? (
            <p className="meta">{tr(locale, "Source en cours de chargement…", "Source loading…")}</p>
          ) : layerStatus("sanctions") !== "ready" ? (
            <p className="meta">
              {tr(locale, "Liste OFAC indisponible pour le moment", "OFAC list unavailable right now")}
              {sanctionsData?.message ? ` : ${sanctionsData.message}` : layers.sanctions?.error ? ` : ${layers.sanctions.error}` : "."}
            </p>
          ) : sanctions ? (
            <>
              <dl className="kv">
                <dt>{tr(locale, "Entités listées", "Listed entities")}</dt>
                <dd>{int(sanctions.entities)} · {tr(locale, "adresse dans le pays", "address in the country")}</dd>
                {sanctions.programs.length ? (
                  <>
                    <dt>{tr(locale, "Programmes", "Programs")}</dt>
                    <dd>
                      {sanctions.programs
                        .slice(0, 8)
                        .map((p) => (p.count === null ? p.name : `${p.name} (${p.count})`))
                        .join(", ")}
                      {sanctions.programs.length > 8 ? ` … +${sanctions.programs.length - 8}` : ""}
                    </dd>
                  </>
                ) : null}
              </dl>
              {sanctionsData?.caveat ? <p className="feed-caveat mt-1">{sanctionsData.caveat}</p> : null}
            </>
          ) : (
            <p className="empty-line">{tr(locale, "Rien dans nos sources : aucune entité de la liste SDN de l'OFAC avec une adresse dans ce pays.", "Nothing in our sources: no entity of the OFAC SDN list with an address in this country.")}</p>
          )}
          {sanctionsData ? (
            <p className="meta mt-1">
              {sanctionsData.sourceName}
              {sanctionsData.asOf ? ` · ${tr(locale, "liste du", "list as of")} ${absoluteDateTime(sanctionsData.asOf, locale)}` : ` · ${tr(locale, "date de la liste non publiée par la source", "list date not published by the source")}`}
            </p>
          ) : null}
        </Section>

        <Section title={tr(locale, "Installations connues", "Known facilities")}>
          <div className="space-y-1.5">
            <FacilityList layerId="nuclear_plants" features={nuclearFeatures} locale={locale} status={layerStatus("nuclear_plants")} />
            <FacilityList layerId="military_bases" features={baseFeatures} locale={locale} status={layerStatus("military_bases")} />
          </div>
          <p className="meta mt-1">{tr(locale, "Source : Wikidata (base collaborative, couverture non exhaustive).", "Source: Wikidata (collaborative, coverage not exhaustive).")}</p>
        </Section>
        {(["nuclear", "space", "uap"] as const).map((key) =>
          sections[key].recent.length ? <FeedSection key={key} sectionKey={key} data={sections[key]} locale={locale} now={now} status={feedStatus} /> : null,
        )}

        <Section title={tr(locale, "Économie", "Economy")} color={THEME_COLORS.economy}>
          {markets.length ? (
            <ul className="space-y-1.5">
              {markets.slice(0, 4).map((item) => (
                <li key={item.id} className="market-row">
                  <span className="min-w-0">
                    <span className="block text-[12px] text-[#e3f3ff]">{item.title}</span>
                    <span className="meta block">
                      {item.sourceName} · <ItemTime item={item} locale={locale} now={now} />
                    </span>
                  </span>
                  {item.metric?.unit === "%" ? (
                    <span className="metric" data-tone={item.metric.value > 0 ? "up" : item.metric.value < 0 ? "down" : "flat"} title={item.metric.label}>
                      {item.metric.value > 0 ? "+" : ""}
                      {item.metric.value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : feedStatus === "loading" ? (
            <p className="meta">{tr(locale, "Chargement…", "Loading…")}</p>
          ) : (
            <p className="empty-line">{tr(locale, "Aucune cotation de ce pays dans nos sources de marché.", "No quote for this country in our market sources.")}</p>
          )}
          <div className="mt-2">
            {indicators.status === "loading" ? (
              <p className="meta">{tr(locale, "Indicateurs Banque mondiale : chargement…", "World Bank indicators: loading…")}</p>
            ) : indicators.status === "error" || !indicators.data ? (
              <p className="meta">{tr(locale, "Indicateurs Banque mondiale : service indisponible.", "World Bank indicators: service unavailable.")}</p>
            ) : (
              <dl className="kv">
                {(["population", "gdp"] as const).map((key) => {
                  const indicator = indicators.data![key];
                  const available = indicator.status === "available" && indicator.value !== null;
                  const title = key === "population" ? tr(locale, "Population", "Population") : tr(locale, "PIB nominal", "Nominal GDP");
                  return (
                    <div key={key} className="contents">
                      <dt>{title}</dt>
                      <dd>
                        {available ? (
                          <a href={indicator.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline" title={tr(locale, "Source : Banque mondiale", "Source: World Bank")}>
                            {new Intl.NumberFormat(fr ? "fr-FR" : "en-US", key === "gdp" ? { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 } : { maximumFractionDigits: 0 }).format(indicator.value!)} ({indicator.year})
                          </a>
                        ) : indicator.status === "error" ? (
                          tr(locale, "Banque mondiale indisponible", "World Bank unavailable")
                        ) : (
                          tr(locale, "Non publié par la Banque mondiale", "Not published by the World Bank")
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
            <p className="meta mt-1">{tr(locale, "Indicateurs annuels : dernière année publiée, pas du temps réel.", "Annual indicators: latest published year, not real time.")}</p>
          </div>
        </Section>

        <Section title={tr(locale, "Dirigeants", "Leaders")}>
          {indicators.status === "loading" ? (
            <p className="meta">{tr(locale, "Chargement…", "Loading…")}</p>
          ) : leaders?.status === "available" && leaders.leaders.length ? (
            <dl className="kv">
              {leaders.leaders.map((leader) => (
                <div key={`${leader.role}-${leader.wikidataId}`} className="contents">
                  <dt>{leader.role === "head_of_state" ? tr(locale, "Chef de l'État", "Head of state") : tr(locale, "Chef du gouvernement", "Head of government")}</dt>
                  <dd>
                    <a href={leader.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {leader.name}
                    </a>
                    {leader.since ? <span className="meta block">{tr(locale, "depuis", "since")} {leader.since}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="empty-line">
              {leaders?.status === "error" || indicators.status === "error"
                ? tr(locale, "Wikidata indisponible pour le moment.", "Wikidata unavailable right now.")
                : tr(locale, "Aucun dirigeant renseigné dans Wikidata.", "No leader recorded in Wikidata.")}
            </p>
          )}
          <p className="meta mt-1">
            {tr(locale, "Source : Wikidata (base communautaire, peut retarder sur un changement récent)", "Source: Wikidata (community-maintained, may lag recent changes)")}
            {leaders?.fetchedAt ? ` · ${absoluteDateTime(leaders.fetchedAt, locale)}` : ""}
          </p>
        </Section>
      </div>
    </section>
  );
}
