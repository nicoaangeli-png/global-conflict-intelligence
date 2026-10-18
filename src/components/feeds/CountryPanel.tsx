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
import { THEME_COLORS, THEME_LABELS, countryMarkets, countrySections, flagEmoji, isLive, itemTime, label, type CountrySectionKey } from "./feedModel";
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

function MiniItem({ item, locale, now }: { item: LiveItem; locale: Locale; now: number }) {
  const selectFeedItem = useIntelStore((s) => s.selectFeedItem);
  return (
    <li className="mini-item">
      <div className="flex flex-wrap items-center gap-1.5">
        {isLive(item, now) ? <LivePill locale={locale} /> : null}
        <NatureBadge item={item} locale={locale} />
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
      {item.caveat ? <p className="feed-caveat">{item.caveat}</p> : null}
    </li>
  );
}

function FeedSection({
  sectionKey,
  data,
  locale,
  now,
  status,
}: {
  sectionKey: CountrySectionKey;
  data: { recent: LiveItem[]; older: LiveItem | null };
  locale: Locale;
  now: number;
  status: Load<unknown>["status"];
}) {
  return (
    <Section title={label(THEME_LABELS[sectionKey], locale)} color={THEME_COLORS[sectionKey]}>
      {data.recent.length ? (
        <ul className="space-y-2">
          {data.recent.slice(0, 5).map((item) => (
            <MiniItem key={item.id} item={item} locale={locale} now={now} />
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

export function CountryPanel() {
  const country = useIntelStore((s) => s.country);
  const locale = useIntelStore((s) => s.locale);
  const clusters = useIntelStore((s) => s.clusters);
  const storeFeeds = useIntelStore((s) => s.feeds);
  const range = useIntelStore((s) => s.filters.range);
  const setCountry = useIntelStore((s) => s.setCountry);
  const select = useIntelStore((s) => s.select);
  const openAura = useIntelStore((s) => s.openAura);
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

  // Les éléments déjà chargés par le fil complètent la requête pays (même contrat).
  const items = useMemo(() => {
    const map = new Map<string, LiveItem>();
    for (const item of storeFeeds) if (item.countries.includes(iso)) map.set(item.id, item);
    for (const item of countryFeeds.data ?? []) map.set(item.id, item);
    return [...map.values()];
  }, [storeFeeds, countryFeeds.data, iso]);

  const sections = useMemo(() => countrySections(items, iso, now), [items, iso, now]);
  const markets = useMemo(() => countryMarkets(items, iso), [items, iso]);

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

        <FeedSection sectionKey="social" data={sections.social} locale={locale} now={now} status={feedStatus} />
        <FeedSection sectionKey="disaster" data={sections.disaster} locale={locale} now={now} status={feedStatus} />
        <FeedSection sectionKey="health" data={sections.health} locale={locale} now={now} status={feedStatus} />
        <FeedSection sectionKey="un" data={sections.un} locale={locale} now={now} status={feedStatus} />
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
