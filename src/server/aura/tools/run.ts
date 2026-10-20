import "server-only";
import { getAirspaceActivity } from "@/server/airspace";
import { getCountryIndicators } from "@/server/countryIndicators";
import { getFeeds } from "@/server/feeds";
import { filtersFromSearchParams } from "@/server/filters";
import { queryClusters, queryLatestEvents, queryStats } from "@/server/intel";
import { getCountryLeaders } from "@/server/leaders";
import { getSourceHealth } from "@/server/health/registry";
import { loadWorldIndex } from "@/server/world";
import { normalizeCountryName } from "@/lib/geo/country";
import { REAL_DATASETS } from "@/types/conflict";
import { FEED_CATEGORIES, type FeedCategory } from "@/types/feeds";
import { RANGE_KEYS } from "../config";
import { SELECTED_ISO3 } from "../context";
import type { AgentContext } from "../types";
import { isoOfStoreCountry, resolveIso3Only, resolveRequestedCountry } from "./country";
import { boundedLiveFeedData, LIVE_FEEDS_DEFAULT_HOURS, LIVE_FEEDS_DEFAULT_LIMIT, LIVE_FEEDS_MAX_HOURS, LIVE_FEEDS_MAX_LIMIT, optionalBoundedInteger } from "./liveFeeds";
import type { ToolArgs, ToolResult } from "./types";
import { getOrbitalEvents } from "./detection";

/**
 * Exécution des outils internes d'AURA. Chaque outil consomme les services métier
 * d'ORBITAL (base de conflits, flux, santé des sources, Wikidata, Banque mondiale,
 * OpenSky) : aucune logique de données parallèle ici, seulement validation des
 * arguments et mise en forme.
 */

const rangeOf = (value: unknown) => (typeof value === "string" && (RANGE_KEYS as string[]).includes(value) ? value : "30d");
const realFilters = (range: string) =>
  filtersFromSearchParams(new URLSearchParams({ range, datasets: REAL_DATASETS.join(",") }));
const isDemoRecord = (record: { sourceDataset?: string; dataset?: string; confidence?: string; provenance?: string }) =>
  (record.sourceDataset ?? record.dataset ?? "").startsWith("demo") || record.confidence === "DEMO" || record.provenance === "demonstration";

const UNIT_LABEL: Record<string, string> = {
  acled: "incident codé par la source",
  ucdp: "incident codé par la source",
  gdelt: "mention presse",
  firms: "détection thermique satellite",
  "import:csv": "enregistrement importé par l'opérateur",
};
const FATALITIES_DATASETS = new Set(["acled", "ucdp", "import:csv"]);

export async function runTool(name: string, args: ToolArgs, context: AgentContext): Promise<ToolResult> {
  switch (name) {
    case "get_orbital_events":
      return getOrbitalEvents(args);
    case "get_platform_overview": {
      const range = rangeOf(args.range);
      const filters = realFilters(range);
      const [stats, clusterData] = await Promise.all([queryStats(filters), queryClusters(filters, 2.4)]);
      const world = await loadWorldIndex().catch(() => null);
      const byCountry = new Map<string, { events: number; fatalities: number }>();
      for (const cluster of clusterData.clusters) {
        if (isDemoRecord({ confidence: cluster.confidence }) || cluster.realShare <= 0) continue;
        const entry = byCountry.get(cluster.country) ?? { events: 0, fatalities: 0 };
        entry.events += cluster.eventCount;
        entry.fatalities += cluster.fatalities;
        byCountry.set(cluster.country, entry);
      }
      const realSources = stats.sources.filter((source) => !isDemoRecord(source));
      const latestEventAt = realSources.reduce<string | null>(
        (latest, source) => (source.latestEventAt && (!latest || source.latestEventAt > latest) ? source.latestEventAt : latest),
        null,
      );
      return {
        status: realSources.some((source) => source.recordsInSelection > 0) ? "ok" : "empty",
        source: "Base ORBITAL (ACLED, UCDP, GDELT, FIRMS, imports opérateur)",
        detail: `fenêtre ${range} · plus récent ${latestEventAt ?? "inconnu"}`,
        data: {
          range,
          activeZones: stats.activeZones,
          majorZones: stats.majorZones,
          recordsWithinSelection: stats.periodCounts?.withinSelection,
          recordsAbsolute: stats.periodCounts?.absolute,
          coverage: { documented: stats.coverage?.documented, media: stats.coverage?.media, thermal: stats.coverage?.thermal },
          sources: realSources.map((source) => ({
            dataset: source.dataset,
            provenance: source.provenance,
            unit: source.unit,
            dateBasis: source.dateBasis,
            fatalitiesApplicable: source.fatalitiesApplicable,
            recordsInSelection: source.recordsInSelection,
            recordsInStore: source.recordsInStore,
            latestEventAt: source.latestEventAt,
          })),
          connectors: stats.connectors.map((connector) => {
            const health = getSourceHealth(`connector:${connector.id === "import" ? "csv" : connector.id}`);
            return {
              id: connector.id,
              configured: connector.configured,
              reachable: connector.reachable,
              events: connector.events,
              health: health?.status ?? null,
              lastSuccessAt: health?.lastSuccessAt ?? null,
              newestDataAt: health?.newestDataAt ?? null,
            };
          }),
          lastIngestAt: stats.freshness?.lastIngestAt,
          topCountries: [...byCountry.entries()]
            .sort((left, right) => right[1].events - left[1].events)
            .slice(0, 12)
            .map(([country, totals]) => ({ country, iso3: isoOfStoreCountry(country, world), ...totals })),
          notes:
            "Unité = enregistrements, pas incidents distincts. UCDP/ACLED = incidents codés par la source, publiés avec un décalage (voir latestEventAt). GDELT = mentions presse sans bilan. FIRMS = détections thermiques, jamais une frappe confirmée ni un bilan humain. Aucune donnée de démonstration.",
        },
      };
    }
    case "get_country_activity": {
      const range = rangeOf(args.range);
      const resolved = await resolveRequestedCountry(args, context);
      if (!resolved.ok) return { status: "error", source: "Base ORBITAL", data: { error: resolved.error } };
      const filters = realFilters(range);
      const { clusters } = await queryClusters(filters, 2.4);
      const wantedName = normalizeCountryName(resolved.label);
      const storeNames = [
        ...new Set(
          clusters
            .map((cluster) => cluster.country)
            .filter((country) => (resolved.iso3 ? isoOfStoreCountry(country, resolved.world) === resolved.iso3 : normalizeCountryName(country) === wantedName)),
        ),
      ];
      if (!storeNames.length) {
        return {
          status: "empty",
          source: "Base ORBITAL",
          detail: `${resolved.label} · aucun enregistrement sur ${range}`,
          data: {
            country: resolved.label,
            iso3: resolved.iso3,
            range,
            events: [],
            note: "Aucun enregistrement réel dans la base ORBITAL pour ce pays et cette période. Cela ne prouve pas l'absence de conflit : seulement l'absence de couverture dans ces sources.",
          },
        };
      }
      const events = (await queryLatestEvents({ ...filters, countries: storeNames }, 25)).filter((event) => !isDemoRecord(event)).slice(0, 15);
      return {
        status: events.length ? "ok" : "empty",
        source: "Base ORBITAL",
        detail: `${resolved.label} · ${events.length} enregistrements récents sur ${range}${events[0] ? ` · plus récent ${events[0].eventDate.slice(0, 10)}` : ""}`,
        data: {
          country: resolved.label,
          iso3: resolved.iso3,
          matchedStoreNames: storeNames,
          range,
          events: events.map((event) => ({
            date: event.eventDate.slice(0, 16),
            type: event.eventType,
            place: [event.locality, event.region].filter(Boolean).join(", "),
            title: event.title ?? undefined,
            geoPrecision: event.geoPrecision ?? undefined,
            fatalities: FATALITIES_DATASETS.has(event.sourceDataset) && event.confidence !== "MEDIA_SIGNAL" ? event.fatalities : null,
            confidence: event.confidence,
            dataset: event.sourceDataset,
            recordKind: UNIT_LABEL[event.sourceDataset] ?? "enregistrement",
            actors: event.actors.slice(0, 3),
            source: event.source,
            url: event.sourceUrl || undefined,
          })),
          note: "fatalities = null signifie non applicable ou inconnu, jamais zéro victime.",
        },
      };
    }
    case "get_live_feeds": {
      if (Object.hasOwn(args, "category") && typeof args.category !== "string") {
        return { status: "error", source: "Flux mondiaux ORBITAL", data: { error: "category doit être une chaîne parmi les catégories reconnues" } };
      }
      const rawCategory = typeof args.category === "string" ? args.category.trim().toLowerCase() : "";
      if (rawCategory && !(FEED_CATEGORIES as readonly string[]).includes(rawCategory)) {
        return { status: "error", source: "Flux mondiaux ORBITAL", data: { error: "Catégorie de flux inconnue" } };
      }
      const category = (rawCategory || undefined) as FeedCategory | undefined;
      if (Object.hasOwn(args, "country_iso3") && typeof args.country_iso3 !== "string") {
        return { status: "error", source: "Flux mondiaux ORBITAL", data: { error: "country_iso3 doit être un code ISO alpha-3" } };
      }
      const rawCountry = typeof args.country_iso3 === "string" ? args.country_iso3 : "";
      if (rawCountry && !SELECTED_ISO3.test(rawCountry)) {
        return { status: "error", source: "Flux mondiaux ORBITAL", data: { error: "Code pays ISO alpha-3 invalide" } };
      }
      const hours = optionalBoundedInteger(args, "hours", LIVE_FEEDS_DEFAULT_HOURS, 1, LIVE_FEEDS_MAX_HOURS);
      if (hours === null) {
        return { status: "error", source: "Flux mondiaux ORBITAL", data: { error: `hours doit être un entier compris entre 1 et ${LIVE_FEEDS_MAX_HOURS}` } };
      }
      const limit = optionalBoundedInteger(args, "limit", LIVE_FEEDS_DEFAULT_LIMIT, 1, LIVE_FEEDS_MAX_LIMIT);
      if (limit === null) {
        return { status: "error", source: "Flux mondiaux ORBITAL", data: { error: `limit doit être un entier compris entre 1 et ${LIVE_FEEDS_MAX_LIMIT}` } };
      }
      const from = Date.now() - hours * 60 * 60 * 1000;
      const response = await getFeeds({ category, country: rawCountry || undefined, sinceMs: from, limit });
      const usableSource = response.sources
        .filter((source) => !category || source.category === category)
        .some((source) => source.status === "ok" || source.status === "stale");
      const data = boundedLiveFeedData(response, category, rawCountry, hours, response.items);
      return {
        status: data.items.length ? "ok" : usableSource ? "empty" : "unavailable",
        source: "Flux mondiaux ORBITAL",
        detail: `${category ?? "toutes catégories"} · ${rawCountry || "monde"} · ${hours} h · ${data.items.length} élément(s)${data.truncated ? ` · ${data.omittedItems} omis` : ""}`,
        data,
      };
    }
    case "get_country_leaders": {
      const resolved = await resolveIso3Only(args, context);
      if ("error" in resolved) return { status: "error", source: "Wikidata", data: resolved };
      const leaders = await getCountryLeaders(resolved.iso3);
      return {
        status: leaders.status === "available" ? "ok" : leaders.status === "error" ? "error" : "unavailable",
        source: "Wikidata",
        detail: `${resolved.iso3} · ${leaders.leaders.length} mandat(s) sans date de fin`,
        url: "https://www.wikidata.org/",
        data: {
          ...leaders,
          caveat: "Seuls les mandats sans date de fin sont listés : liste possiblement incomplète ou en retard. À confirmer par la recherche web.",
        },
      };
    }
    case "get_country_indicators": {
      const resolved = await resolveIso3Only(args, context);
      if ("error" in resolved) return { status: "error", source: "Banque mondiale", data: resolved };
      const indicators = await getCountryIndicators(resolved.iso3);
      if (!indicators) return { status: "unavailable", source: "Banque mondiale", data: { error: "Code pays inconnu du référentiel" } };
      const available = indicators.population.status === "available" || indicators.gdp.status === "available";
      const failed = indicators.population.status === "error" && indicators.gdp.status === "error";
      return {
        status: available ? "ok" : failed ? "error" : "unavailable",
        source: "Banque mondiale (données annuelles)",
        detail: `${resolved.iso3} · population ${indicators.population.year ?? "n/d"} · PIB ${indicators.gdp.year ?? "n/d"}`,
        url: "https://data.worldbank.org/",
        data: { ...indicators, caveat: "Valeurs annuelles avec année de référence : ni temps réel ni indicateur de stabilité." },
      };
    }
    case "get_airspace_activity": {
      const resolved = await resolveIso3Only(args, context);
      if ("error" in resolved) return { status: "error", source: "OpenSky Network", data: resolved };
      const activity = await getAirspaceActivity(resolved.iso3);
      if ("error" in activity) return { status: "unavailable", source: "OpenSky Network", data: activity };
      return {
        status: "ok",
        source: "OpenSky Network (ADS-B civil)",
        detail: `${resolved.iso3} · ${activity.airborne} en vol · observé ${activity.observedAt.slice(0, 16)}`,
        url: "https://opensky-network.org/",
        data: activity,
      };
    }
    default:
      return { status: "error", source: "outil inconnu", data: { error: `Outil inconnu : ${name}` } };
  }
}
