import type { LayerFeature } from "@/types/layers";
import { FeedError } from "@/server/feeds/util";
import { beforeOrToday, binding, dateOnly, feature, fetchSparql, iso3, pointFromWkt, text, wikidataId, type WikidataBinding } from "./common";

/** Borne documentée : évite une réponse SPARQL de dizaines de milliers de bases historiques. */
export const MILITARY_BASE_LIMIT = 500;

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
  return parseNuclearPlants(await fetchSparql(buildNuclearPlantsQuery()), nowMs);
}

export function buildMilitaryBasesQuery(limit = MILITARY_BASE_LIMIT): string {
  if (!Number.isInteger(limit) || limit < 1 || limit > MILITARY_BASE_LIMIT) throw new FeedError("Limite des bases militaires invalide.");
  return `SELECT ?item ?itemLabel ?coord ?countryIso ?operatorLabel ?typeLabel ?closed ?ended ?conditionLabel WHERE {
  ?type wdt:P279* wd:Q18691599; rdfs:label ?typeName.
  FILTER(LANG(?typeName) = "en")
  FILTER(REGEX(STR(?typeName), "military|naval|barracks|garrison|air force|airbase|air base|missile|radar", "i"))
  ?item wdt:P31 ?type; wdt:P625 ?coord.
  OPTIONAL { ?item wdt:P17/wdt:P298 ?countryIso. }
  OPTIONAL { ?item wdt:P137 ?operator. }
  OPTIONAL { ?item wdt:P31 ?type. }
  OPTIONAL { ?item wdt:P576 ?closed. }
  OPTIONAL { ?item wdt:P3999 ?ended. }
  OPTIONAL { ?item wdt:P5817 ?condition. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en,mul". }
}
LIMIT ${limit}`;
}

function excludedMilitaryBase(row: WikidataBinding): boolean {
  if (binding(row, "closed") || binding(row, "ended")) return true;
  const condition = (binding(row, "conditionLabel") ?? "").toLocaleLowerCase("fr");
  return /\b(détruit|detruit|destroyed|abandonn[ée]|abandoned|demolished|ferm[ée]|closed|decommissioned|disused)\b/.test(condition);
}

/** Écarte les descendants Wikidata manifestement civils (p. ex. tour Eiffel) conservés par une hiérarchie trop large. */
function militaryType(row: WikidataBinding): string | null {
  const type = binding(row, "typeLabel");
  if (!type) return null;
  return /\b(militaire|military|naval|caserne|barracks|garnison|garrison|aérienne|aerienne|air force|airbase|air base|missile|radar)\b/i.test(type) ? type : null;
}

export function parseMilitaryBases(rows: WikidataBinding[]): LayerFeature[] {
  const seen = new Set<string>();
  const features: LayerFeature[] = [];
  for (const row of rows) {
    const qid = wikidataId(binding(row, "item"));
    const geometry = pointFromWkt(binding(row, "coord"));
    const name = text(binding(row, "itemLabel"));
    const type = militaryType(row);
    if (!qid || !geometry || !name || !type || /^Q\d+$/.test(name) || seen.has(qid) || excludedMilitaryBase(row)) continue;
    seen.add(qid);
    features.push(feature(`military_bases:${qid}`, name, [iso3(binding(row, "countryIso"))].filter((x): x is string => !!x), geometry, {
      operator: binding(row, "operatorLabel"),
      type,
      condition: binding(row, "conditionLabel"),
    }, `https://www.wikidata.org/wiki/${qid}`));
  }
  return features;
}

export async function loadMilitaryBases(): Promise<LayerFeature[]> {
  return parseMilitaryBases(await fetchSparql(buildMilitaryBasesQuery(), 8 * 1024 * 1024, 30_000));
}
