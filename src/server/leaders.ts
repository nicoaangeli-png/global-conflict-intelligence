import "server-only";

/**
 * Dirigeants en exercice d'un pays, via Wikidata (SPARQL).
 *
 * P35 = chef de l'État, P6 = chef du gouvernement.
 * Seules les déclarations en cours (sans date de fin ou avec date de fin future)
 * sont retenues. Préfère le rang « preferred » puis « normal », exclut « deprecated ».
 * Gère le repli linguistique fr -> en -> mul pour inclure les entités dont le nom
 * est catalogué en langue universelle/multiple (ex. Emmanuel Macron Q3052772).
 * En cas de cumul chef d'État = chef du gouvernement (ex. USA), l'entrée est fusionnée
 * sans duplication avec rôle explicite et indicateur `cumulative: true`.
 * Inconnu = null + raison, aucune invention de donnée.
 */

export type LeaderRole =
  | "head_of_state"
  | "head_of_government"
  | "head_of_state_and_government";

export type Leader = {
  role: LeaderRole;
  roles?: ("head_of_state" | "head_of_government")[];
  cumulative?: boolean;
  name: string;
  since: string | null;
  wikidataId: string;
  sourceUrl: string;
};

export type LeaderMissingReason =
  | "not_covered"
  | "no_data"
  | "stale"
  | "error"
  | "not_configured";

export type CountryLeaders = {
  iso: string;
  status: "available" | "unavailable" | "error";
  leaders: Leader[];
  reason?: LeaderMissingReason | null;
  source: "Wikidata";
  fetchedAt: string;
};

export type WikidataBinding = Record<string, { value: string } | undefined>;

const ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "ORBITAL/0.2 (contact nicoa.angeli@gmail.com)";
const SUCCESS_TTL = 6 * 60 * 60 * 1000;
const FAILURE_TTL = 60 * 1000;
const cache = new Map<string, { expiresAt: number; result: CountryLeaders }>();
const pending = new Map<string, Promise<CountryLeaders>>();

/**
 * Construit la requête SPARQL pour extraire les chefs d'État et de gouvernement
 * en exercice, avec rangs, dates de début et de fin.
 */
export function buildLeadersQuery(iso: string): string {
  return `SELECT ?role ?person ?personLabel ?start ?end ?rank WHERE {
  ?country wdt:P298 "${iso}" .
  {
    ?country p:P35 ?st .
    ?st ps:P35 ?person .
    ?st wikibase:rank ?rank .
    BIND("head_of_state" AS ?role)
  } UNION {
    ?country p:P6 ?st .
    ?st ps:P6 ?person .
    ?st wikibase:rank ?rank .
    BIND("head_of_government" AS ?role)
  }
  FILTER(?rank != wikibase:DeprecatedRank)
  OPTIONAL { ?st pq:P582 ?end }
  FILTER (!BOUND(?end) || ?end > NOW())
  OPTIONAL { ?st pq:P580 ?start }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en,mul". }
}`;
}

/**
 * Traite les bindings Wikidata bruts :
 * - Exclusion des déclarations dépréciées et des mandats échus.
 * - Préfère PreferredRank sur NormalRank pour chaque rôle.
 * - Déduplique et fusionne les cumuls (chef d'État = chef du gouvernement).
 * - Ordonne : chef d'État (ou cumul) en premier, puis chef du gouvernement.
 */
export function parseWikidataLeaders(
  bindings: WikidataBinding[],
  nowMs: number = Date.now()
): Leader[] {
  const rawByRole: Record<"head_of_state" | "head_of_government", Array<{
    role: "head_of_state" | "head_of_government";
    id: string;
    name: string;
    start: string | null;
    rank: string;
  }>> = {
    head_of_state: [],
    head_of_government: [],
  };

  for (const b of bindings) {
    const role = b.role?.value;
    if (role !== "head_of_state" && role !== "head_of_government") continue;

    const person = b.person?.value ?? "";
    const id = person.split("/").pop() ?? "";
    if (!/^Q\d+$/.test(id)) continue;

    const name = b.personLabel?.value?.trim() ?? "";
    // Libellé non résolu (« Q123 ») ou vide : on ne l'affiche pas (pas d'invention de nom).
    if (!name || /^Q\d+$/.test(name)) continue;

    const rankUri = b.rank?.value ?? "";
    const rank = rankUri.includes("#") ? rankUri.split("#").pop()! : rankUri || "NormalRank";
    if (rank === "DeprecatedRank") continue;

    // Mandat en cours uniquement : exclure toute date de fin passée
    if (b.end?.value) {
      const endMs = new Date(b.end.value).getTime();
      if (!Number.isNaN(endMs) && endMs <= nowMs) continue;
    }

    const start = b.start?.value ? b.start.value.slice(0, 10) : null;
    rawByRole[role].push({ role, id, name, start, rank });
  }

  // Filtrage par rôle : préférer PreferredRank puis NormalRank
  const filteredByRole: Record<"head_of_state" | "head_of_government", Map<string, {
    id: string;
    name: string;
    start: string | null;
    rank: string;
  }>> = {
    head_of_state: new Map(),
    head_of_government: new Map(),
  };

  for (const role of ["head_of_state", "head_of_government"] as const) {
    const list = rawByRole[role];
    if (!list.length) continue;
    const hasPreferred = list.some((x) => x.rank === "PreferredRank");
    const targetRank = hasPreferred ? "PreferredRank" : "NormalRank";
    for (const item of list) {
      if (item.rank !== targetRank) continue;
      // Si la même personne a plusieurs déclarations du même rang, retenir celle avec date
      const existing = filteredByRole[role].get(item.id);
      if (!existing || (!existing.start && item.start)) {
        filteredByRole[role].set(item.id, item);
      }
    }
  }

  const hosList = Array.from(filteredByRole.head_of_state.entries());
  const hogMap = filteredByRole.head_of_government;
  const hogList = Array.from(hogMap.entries());
  const leaders: Leader[] = [];
  const handledIds = new Set<string>();

  // Cas où chef d'État = chef du gouvernement (ex. USA, BRA, ZAF, CHE) : fusion non dupliquée
  for (const [id, hos] of hosList) {
    if (hogMap.has(id)) {
      const hog = hogMap.get(id)!;
      handledIds.add(id);
      let since = hos.start;
      if (hog.start && (!since || hog.start < since)) {
        since = hog.start;
      }
      leaders.push({
        role: "head_of_state_and_government",
        roles: ["head_of_state", "head_of_government"],
        cumulative: true,
        name: hos.name,
        since,
        wikidataId: id,
        sourceUrl: `https://www.wikidata.org/wiki/${id}`,
      });
    }
  }

  // Chefs d'État distincts
  for (const [id, hos] of hosList) {
    if (handledIds.has(id)) continue;
    leaders.push({
      role: "head_of_state",
      roles: ["head_of_state"],
      cumulative: false,
      name: hos.name,
      since: hos.start,
      wikidataId: id,
      sourceUrl: `https://www.wikidata.org/wiki/${id}`,
    });
  }

  // Chefs du gouvernement distincts
  for (const [id, hog] of hogList) {
    if (handledIds.has(id)) continue;
    leaders.push({
      role: "head_of_government",
      roles: ["head_of_government"],
      cumulative: false,
      name: hog.name,
      since: hog.start,
      wikidataId: id,
      sourceUrl: `https://www.wikidata.org/wiki/${id}`,
    });
  }

  // Tri stable : chef d'État (ou cumul) en tête, puis chef du gouvernement, puis par date décroissante
  leaders.sort((a, b) => {
    const roleOrder: Record<LeaderRole, number> = {
      head_of_state_and_government: 0,
      head_of_state: 1,
      head_of_government: 2,
    };
    const diff = (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9);
    if (diff !== 0) return diff;
    return (b.since ?? "").localeCompare(a.since ?? "");
  });

  return leaders;
}

async function fetchLeaders(iso: string): Promise<CountryLeaders> {
  const fetchedAt = new Date().toISOString();
  try {
    const url = `${ENDPOINT}?${new URLSearchParams({ query: buildLeadersQuery(iso) }).toString()}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": USER_AGENT,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error("Wikidata request failed");
    const json = (await res.json()) as { results?: { bindings?: WikidataBinding[] } };
    const bindings = json.results?.bindings;
    if (!Array.isArray(bindings)) throw new Error("Invalid Wikidata response");

    const leaders = parseWikidataLeaders(bindings);
    return {
      iso,
      status: leaders.length ? "available" : "unavailable",
      leaders,
      reason: leaders.length ? null : "no_data",
      source: "Wikidata",
      fetchedAt,
    };
  } catch {
    return {
      iso,
      status: "error",
      leaders: [],
      reason: "error",
      source: "Wikidata",
      fetchedAt,
    };
  }
}

export function clearLeadersCache(): void {
  cache.clear();
  pending.clear();
}

export function getCountryLeaders(iso: string): Promise<CountryLeaders> {
  if (!/^[A-Z]{3}$/.test(iso)) {
    return Promise.resolve({
      iso,
      status: "unavailable",
      leaders: [],
      reason: "not_covered",
      source: "Wikidata",
      fetchedAt: new Date().toISOString(),
    });
  }
  const cached = cache.get(iso);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.result);
  const existing = pending.get(iso);
  if (existing) return existing;
  const request = fetchLeaders(iso)
    .then((result) => {
      cache.set(iso, {
        expiresAt: Date.now() + (result.status === "error" ? FAILURE_TTL : SUCCESS_TTL),
        result,
      });
      return result;
    })
    .finally(() => pending.delete(iso));
  pending.set(iso, request);
  return request;
}
