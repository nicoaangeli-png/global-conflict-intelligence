import "server-only";

/**
 * Dirigeants en exercice d'un pays, via Wikidata (SPARQL).
 *
 * P35 = chef de l'État, P6 = chef du gouvernement. Seules les déclarations
 * sans date de fin (P582) sont retenues. Wikidata est maintenu en continu
 * par sa communauté : chaque entrée garde son identifiant et son lien source.
 */

export type LeaderRole = "head_of_state" | "head_of_government";

export type Leader = {
  role: LeaderRole;
  name: string;
  since: string | null;
  wikidataId: string;
  sourceUrl: string;
};

export type CountryLeaders = {
  iso: string;
  status: "available" | "unavailable" | "error";
  leaders: Leader[];
  source: "Wikidata";
  fetchedAt: string;
};

const ENDPOINT = "https://query.wikidata.org/sparql";
const SUCCESS_TTL = 6 * 60 * 60 * 1000;
const FAILURE_TTL = 60 * 1000;
const cache = new Map<string, { expiresAt: number; result: CountryLeaders }>();
const pending = new Map<string, Promise<CountryLeaders>>();

function query(iso: string) {
  return `SELECT ?role ?person ?personLabel ?start WHERE {
  ?country wdt:P298 "${iso}" .
  { ?country p:P35 ?st . ?st ps:P35 ?person . BIND("head_of_state" AS ?role) }
  UNION
  { ?country p:P6 ?st . ?st ps:P6 ?person . BIND("head_of_government" AS ?role) }
  FILTER NOT EXISTS { ?st pq:P582 ?end }
  OPTIONAL { ?st pq:P580 ?start }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
}`;
}

type Binding = Record<string, { value: string } | undefined>;

async function fetchLeaders(iso: string): Promise<CountryLeaders> {
  const fetchedAt = new Date().toISOString();
  try {
    const url = `${ENDPOINT}?${new URLSearchParams({ query: query(iso) }).toString()}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": "OrbitalConflictIntel/0.2 (local analyst console)",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error("Wikidata request failed");
    const json = (await res.json()) as { results?: { bindings?: Binding[] } };
    const bindings = json.results?.bindings;
    if (!Array.isArray(bindings)) throw new Error("Invalid Wikidata response");

    const seen = new Set<string>();
    const leaders: Leader[] = [];
    for (const b of bindings) {
      const role = b.role?.value;
      const person = b.person?.value ?? "";
      const name = b.personLabel?.value ?? "";
      const id = person.split("/").pop() ?? "";
      if ((role !== "head_of_state" && role !== "head_of_government") || !/^Q\d+$/.test(id) || !name) continue;
      // Libellé non résolu (« Q123 ») : on ne l'affiche pas comme un nom.
      if (/^Q\d+$/.test(name)) continue;
      const key = `${role}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      leaders.push({
        role,
        name,
        since: b.start?.value ? b.start.value.slice(0, 10) : null,
        wikidataId: id,
        sourceUrl: `https://www.wikidata.org/wiki/${id}`,
      });
    }
    leaders.sort((a, b) => (a.role === b.role ? (b.since ?? "").localeCompare(a.since ?? "") : a.role === "head_of_state" ? -1 : 1));
    return { iso, status: leaders.length ? "available" : "unavailable", leaders, source: "Wikidata", fetchedAt };
  } catch {
    return { iso, status: "error", leaders: [], source: "Wikidata", fetchedAt };
  }
}

export function getCountryLeaders(iso: string): Promise<CountryLeaders> {
  if (!/^[A-Z]{3}$/.test(iso)) return Promise.resolve({ iso, status: "unavailable", leaders: [], source: "Wikidata", fetchedAt: new Date().toISOString() });
  const cached = cache.get(iso);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.result);
  const existing = pending.get(iso);
  if (existing) return existing;
  const request = fetchLeaders(iso)
    .then((result) => {
      cache.set(iso, { expiresAt: Date.now() + (result.status === "error" ? FAILURE_TTL : SUCCESS_TTL), result });
      return result;
    })
    .finally(() => pending.delete(iso));
  pending.set(iso, request);
  return request;
}
