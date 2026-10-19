import type { LayerFeature } from "@/types/layers";
import { FeedError } from "@/server/feeds/util";
import { beforeOrToday, binding, dateOnly, feature, fetchSparql, iso3, pointFromWkt, text, wikidataId, type WikidataBinding } from "./common";

/**
 * Borne d'affichage documentée : la carte privilégie les installations ayant une
 * présence encyclopédique, sans prétendre constituer un inventaire exhaustif.
 */
export const MILITARY_BASE_LIMIT = 4_000;

/** Une page courte évite les requêtes SPARQL lourdes ou lentes sur Wikidata. */
export const MILITARY_BASE_PAGE_SIZE = 250;
/** Jusqu'à 1 000 candidates par classe avant dédoublonnage et borne finale. */
export const MILITARY_BASE_PAGES_PER_CLASS = 4;

type MilitaryBaseType = "aérienne" | "navale" | "terrestre" | "autre";

interface MilitaryBaseClass {
  qid: string;
  type: MilitaryBaseType;
  /** Les casernes et garnisons ne sont retenues qu'avec une notabilité forte. */
  minSitelinks: number;
}

/**
 * Classes Wikidata explicitement militaires. Chaque requête reste ciblée et
 * paginée ; le classement final est commun, par nombre de sitelinks décroissant.
 */
const MILITARY_BASE_CLASSES: readonly MilitaryBaseClass[] = [
  { qid: "Q695850", type: "aérienne", minSitelinks: 1 }, // base aérienne militaire
  { qid: "Q1324633", type: "navale", minSitelinks: 1 }, // base navale
  { qid: "Q245016", type: "terrestre", minSitelinks: 1 }, // base militaire
  { qid: "Q18691599", type: "autre", minSitelinks: 1 }, // installation militaire
  { qid: "Q131263", type: "terrestre", minSitelinks: 5 }, // caserne
  { qid: "Q88556", type: "terrestre", minSitelinks: 5 }, // garnison
];

const militaryTypeRank: Record<MilitaryBaseType, number> = { aérienne: 0, navale: 1, terrestre: 2, autre: 3 };

export function buildNuclearPlantsQuery(): string {
  return `SELECT ?item ?itemLabel ?coord ?countryIso ?operatorLabel ?start ?closed ?ended ?capacity ?isProject WHERE {
  ?item wdt:P31/wdt:P279* wd:Q134447; wdt:P625 ?coord.
  OPTIONAL { ?item wdt:P17/wdt:P298 ?countryIso. }
  OPTIONAL { ?item wdt:P137 ?operator. }
  OPTIONAL { ?item wdt:P729 ?start. }
  OPTIONAL { ?item wdt:P576 ?closed. }
  OPTIONAL { ?item wdt:P3999 ?ended. }
  OPTIONAL { ?item wdt:P2109 ?capacity. }
  OPTIONAL { ?item wdt:P31/wdt:P279* wd:Q170584. BIND(true AS ?isProject) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en,mul". }
}`;
}

function nuclearStatus(row: WikidataBinding, nowMs: number): string | null {
  const closed = dateOnly(binding(row, "closed")) ?? dateOnly(binding(row, "ended"));
  if (beforeOrToday(closed, nowMs)) return "fermée";
  if (binding(row, "isProject") === "true") return "en construction";
  const commissioned = dateOnly(binding(row, "start"));
  return beforeOrToday(commissioned, nowMs) ? "en service" : null;
}

export function parseNuclearPlants(rows: WikidataBinding[], nowMs = Date.now()): LayerFeature[] {
  const seen = new Set<string>();
  const features: LayerFeature[] = [];
  for (const row of rows) {
    const qid = wikidataId(binding(row, "item"));
    const geometry = pointFromWkt(binding(row, "coord"));
    const name = text(binding(row, "itemLabel"));
    if (!qid || !geometry || !name || /^Q\d+$/.test(name) || seen.has(qid)) continue;
    seen.add(qid);
    const capacityRaw = binding(row, "capacity");
    const capacity = capacityRaw !== null && Number.isFinite(Number(capacityRaw)) ? Number(capacityRaw) : capacityRaw;
    features.push(feature(`nuclear_plants:${qid}`, name, [iso3(binding(row, "countryIso"))].filter((x): x is string => !!x), geometry, {
      operator: binding(row, "operatorLabel"),
      status: nuclearStatus(row, nowMs),
      commissioningDate: dateOnly(binding(row, "start")),
      closureDate: dateOnly(binding(row, "closed")) ?? dateOnly(binding(row, "ended")),
      capacity,
    }, `https://www.wikidata.org/wiki/${qid}`));
  }
  return features;
}

export async function loadNuclearPlants(nowMs = Date.now()): Promise<LayerFeature[]> {
  return parseNuclearPlants(await fetchSparql(buildNuclearPlantsQuery(), 5 * 1024 * 1024, 45_000), nowMs);
}

export function buildMilitaryBasesQuery(
  militaryClass: MilitaryBaseClass = MILITARY_BASE_CLASSES[0],
  limit = MILITARY_BASE_PAGE_SIZE,
  offset = 0,
): string {
  if (!MILITARY_BASE_CLASSES.some((known) => known.qid === militaryClass.qid && known.type === militaryClass.type && known.minSitelinks === militaryClass.minSitelinks) || !Number.isInteger(limit) || limit < 1 || limit > MILITARY_BASE_PAGE_SIZE || !Number.isInteger(offset) || offset < 0) {
    throw new FeedError("Page des bases militaires invalide.");
  }
  return `SELECT ?item ?itemLabel ?coord
  (GROUP_CONCAT(DISTINCT ?countryIso; separator="|") AS ?countryIsos)
  (GROUP_CONCAT(DISTINCT ?operatorLabel; separator=" · ") AS ?operatorLabels)
  (GROUP_CONCAT(DISTINCT ?typeLabel; separator="|") AS ?typeLabels)
  (GROUP_CONCAT(DISTINCT ?conditionLabel; separator="|") AS ?conditionLabels)
  (SAMPLE(?closedValue) AS ?closed) (SAMPLE(?endedValue) AS ?ended)
  (SAMPLE(?sitelinksValue) AS ?sitelinks)
  ("${militaryClass.type}" AS ?baseType)
  (${militaryClass.minSitelinks} AS ?minSitelinks)
WHERE {
  ?item wdt:P31 ?type; wdt:P625 ?coord; wikibase:sitelinks ?sitelinksValue.
  VALUES ?type { wd:${militaryClass.qid} }
  ?type rdfs:label ?typeLabel.
  FILTER(LANG(?typeLabel) = "en")
  FILTER(?sitelinksValue >= ${militaryClass.minSitelinks})
  OPTIONAL { ?item wdt:P17/wdt:P298 ?countryIso. }
  OPTIONAL {
    ?item wdt:P137 ?operator.
    ?operator rdfs:label ?operatorLabel.
    FILTER(LANG(?operatorLabel) = "en")
  }
  OPTIONAL { ?item wdt:P576 ?closedValue. }
  OPTIONAL { ?item wdt:P3999 ?endedValue. }
  OPTIONAL {
    ?item wdt:P5817 ?condition.
    ?condition rdfs:label ?conditionLabel.
    FILTER(LANG(?conditionLabel) = "en")
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en,mul". }
}
GROUP BY ?item ?itemLabel ?coord
ORDER BY DESC(?sitelinks) ?item
LIMIT ${limit}
OFFSET ${offset}`;
}

function excludedMilitaryBase(row: WikidataBinding): boolean {
  if (binding(row, "closed") || binding(row, "ended")) return true;
  const condition = (binding(row, "conditionLabels") ?? binding(row, "conditionLabel") ?? "").toLocaleLowerCase("fr");
  return /(détruit|detruit|destroyed|abandonn[ée]|abandoned|demolished|ferm[ée]|\bclosed\b|decommissioned|disused)/.test(condition);
}

/** Écarte les descendants Wikidata manifestement civils (p. ex. tour Eiffel) conservés par une hiérarchie trop large. */
function militaryType(row: WikidataBinding): string | null {
  const type = binding(row, "typeLabels") ?? binding(row, "typeLabel");
  if (!type) return null;
  return /\b(militaire|military|naval(?:e)?|caserne|barracks|garnison|garrison|aérienne|aerienne|air force|airbase|air base|missile|radar)\b/i.test(type) ? type : null;
}

function militaryBaseType(row: WikidataBinding): MilitaryBaseType | null {
  const value = binding(row, "baseType");
  return value === "aérienne" || value === "navale" || value === "terrestre" || value === "autre" ? value : null;
}

function sitelinks(row: WikidataBinding): number | null {
  const value = Number(binding(row, "sitelinks"));
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function minimumSitelinks(row: WikidataBinding): number | null {
  const value = Number(binding(row, "minSitelinks"));
  return Number.isInteger(value) && value >= 1 ? value : null;
}

function iso3Values(row: WikidataBinding): string[] {
  return [...new Set((binding(row, "countryIsos") ?? binding(row, "countryIso") ?? "").split("|").map(iso3).filter((value): value is string => !!value))];
}

type ParsedMilitaryBase = LayerFeature & { properties: LayerFeature["properties"] & { type: MilitaryBaseType; sitelinks: number } };

/**
 * Déduplique les intersections de classes (p. ex. une base aérienne est aussi
 * une installation militaire), conserve la classe la plus précise et classe la
 * sélection par notabilité Wikidata avant d'appliquer la borne finale.
 */
export function parseMilitaryBases(rows: WikidataBinding[], limit = MILITARY_BASE_LIMIT): LayerFeature[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > MILITARY_BASE_LIMIT) throw new FeedError("Limite des bases militaires invalide.");
  const byQid = new Map<string, ParsedMilitaryBase>();
  for (const row of rows) {
    const qid = wikidataId(binding(row, "item"));
    const geometry = pointFromWkt(binding(row, "coord"));
    const name = text(binding(row, "itemLabel"));
    const type = militaryBaseType(row);
    const count = sitelinks(row);
    const minimum = minimumSitelinks(row);
    if (!qid || !geometry || !name || !type || count === null || minimum === null || count < minimum || !militaryType(row) || /^Q\d+$/.test(name) || excludedMilitaryBase(row)) continue;
    const candidate = feature(`military_bases:${qid}`, name, iso3Values(row), geometry, {
      operator: binding(row, "operatorLabels") ?? binding(row, "operatorLabel"),
      type,
      condition: binding(row, "conditionLabels") ?? binding(row, "conditionLabel"),
      sitelinks: count,
    }, `https://www.wikidata.org/wiki/${qid}`) as ParsedMilitaryBase;
    const previous = byQid.get(qid);
    if (!previous || count > previous.properties.sitelinks || (count === previous.properties.sitelinks && militaryTypeRank[type] < militaryTypeRank[previous.properties.type])) {
      byQid.set(qid, candidate);
    }
  }
  return [...byQid.values()]
    .sort((left, right) => right.properties.sitelinks - left.properties.sitelinks || left.name.localeCompare(right.name, "fr"))
    .slice(0, limit);
}

export async function loadMilitaryBases(): Promise<LayerFeature[]> {
  const rows: WikidataBinding[] = [];
  for (const militaryClass of MILITARY_BASE_CLASSES) {
    for (let page = 0; page < MILITARY_BASE_PAGES_PER_CLASS; page += 1) {
      const result = await fetchSparql(buildMilitaryBasesQuery(militaryClass, MILITARY_BASE_PAGE_SIZE, page * MILITARY_BASE_PAGE_SIZE), 2 * 1024 * 1024, 30_000);
      rows.push(...result);
      if (result.length < MILITARY_BASE_PAGE_SIZE) break;
    }
  }
  return parseMilitaryBases(rows);
}
