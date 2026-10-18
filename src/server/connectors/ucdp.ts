import type { ConflictEvent, EventType } from "@/types/conflict";
import { parseCsv } from "./csvImport";
import { ConnectorError, type Connector, safeFetch, providerDate, validCoordinates } from "./types";

/**
 * Connecteur UCDP (Georeferenced Event Dataset).
 *
 * Base de recherche académique (Uppsala universitet) : sert à l'analyse
 * historique et à la contextualisation. Version d'API et fenêtre
 * configurables par variables d'environnement.
 *
 * Deux modes :
 *  - avec `UCDP_ACCESS_TOKEN` : API officielle (fenêtre glissante) ;
 *  - sans jeton : téléchargement libre des fichiers « GED Candidate »
 *    (publication mensuelle, licence CC BY 4.0) depuis ucdp.uu.se/downloads.
 *    Les fichiers ne changent qu'une fois par mois : ils sont mis en cache
 *    12 h pour ne pas les retélécharger à chaque ingestion (15 min).
 */

const BASE = "https://ucdpapi.pcr.uu.se/api";
const VERSION = process.env.UCDP_VERSION ?? "25.1";
const DOWNLOADS = "https://ucdp.uu.se/downloads/";
const CANDIDATE_TTL_MS = 12 * 3600e3;

/** `type_of_violence` UCDP → classification interne. */
const UCDP_TYPES: Record<number, EventType> = {
  1: "Battles",
  2: "Battles",
  3: "Violence against civilians",
};

/** Ligne API (nombres) ou CSV (chaînes) : mêmes noms de colonnes. */
interface UcdpRow {
  id?: number | string;
  relid?: string;
  date_start?: string;
  country?: string;
  region?: string;
  latitude?: number | string;
  longitude?: number | string;
  type_of_violence?: number | string;
  side_a?: string;
  side_b?: string;
  deaths_civilians?: number | string;
  best?: number | string;
  source_headline?: string;
  source_article?: string;
  where_description?: string;
}

function toEvent(row: UcdpRow, sourceUrl: string): ConflictEvent | null {
  if (!validCoordinates(row.latitude, row.longitude)) return null;
  const date = providerDate(row.date_start);
  if (!date || row.id == null || row.id === "") return null;
  const violence = Number(row.type_of_violence) || 1;
  return {
    id: `ucdp-${row.id}`,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    country: row.country ?? "",
    region: row.region ?? "",
    locality: row.where_description ?? "",
    eventType: UCDP_TYPES[violence] ?? "Battles",
    subEventType: violence === 3 ? "Violence ciblée" : "Affrontement",
    actors: [row.side_a, row.side_b].filter((a): a is string => Boolean(a)),
    fatalities: Math.max(0, Math.trunc(Number(row.best ?? row.deaths_civilians) || 0)),
    source: row.source_headline ? `UCDP · ${row.source_headline.split(";")[0]}` : "UCDP GED",
    sourceUrl,
    sourceDataset: "ucdp",
    confidence: "REPORTED",
    eventDate: date,
    updatedAt: new Date().toISOString(),
  };
}

const candidateCache = globalThis as unknown as { __orbitalUcdpCandidate?: { at: number; files: string[]; events: ConflictEvent[] } };

/** Fichiers CSV « GED Candidate » actuellement publiés (le plus récent d'abord). */
async function candidateFiles(): Promise<string[]> {
  const res = await safeFetch("ucdp", DOWNLOADS, { headers: { Accept: "text/html" } }, 20000);
  const html = await res.text();
  const files = [...new Set(html.match(/https:\/\/ucdp\.uu\.se\/downloads\/candidateged\/GEDEvent_v[\w.]+\.csv/gi) ?? [])];
  if (!files.length) throw new ConnectorError("Aucun fichier UCDP Candidate trouvé", "ucdp", "parse");
  return files;
}

async function fetchCandidate(days: number): Promise<ConflictEvent[]> {
  const cached = candidateCache.__orbitalUcdpCandidate;
  let events = cached && Date.now() - cached.at < CANDIDATE_TTL_MS ? cached.events : null;
  if (!events) {
    const files = await candidateFiles();
    const byId = new Map<string, ConflictEvent>();
    for (const file of files) {
      const res = await safeFetch("ucdp", file, { headers: { Accept: "text/csv" } }, 60000);
      for (const row of parseCsv(await res.text()) as UcdpRow[]) {
        const event = toEvent(row, `${DOWNLOADS}#candidate`);
        if (event) byId.set(event.id, event);
      }
    }
    events = [...byId.values()];
    candidateCache.__orbitalUcdpCandidate = { at: Date.now(), files, events };
  }
  // Publication avec 1 à 2 mois de décalage : on garde au moins un an
  // pour que les vues 6 mois / 1 an soient alimentées.
  const from = Date.now() - Math.max(days, 365) * 86400e3;
  return events.filter((event) => Date.parse(event.eventDate) >= from);
}

export const ucdpConnector: Connector = {
  id: "ucdp",
  label: "UCDP GED",

  isConfigured() {
    // Sans jeton API, le connecteur bascule sur les fichiers publics mensuels.
    return process.env.UCDP_DISABLED !== "1";
  },

  describe() {
    if (process.env.UCDP_ACCESS_TOKEN) return `API UCDP GED ${VERSION} — jeu de données académique géoréférencé (validation).`;
    const latest = candidateCache.__orbitalUcdpCandidate?.events.reduce((max, e) => (e.eventDate > max ? e.eventDate : max), "");
    return `UCDP GED Candidate — fichiers publics mensuels (CC BY 4.0)${latest ? `, données jusqu'au ${latest.slice(0, 10)}` : ""}. Décalage de publication : 1 à 2 mois.`;
  },

  async fetchEvents({ days }) {
    if (!this.isConfigured()) throw new ConnectorError("UCDP non configuré", "ucdp", "config");
    if (!process.env.UCDP_ACCESS_TOKEN) return fetchCandidate(days);
    const start = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
    const params = new URLSearchParams({ pagesize: "1000", StartDate: start, EndDate: new Date().toISOString().slice(0, 10) });
    const rows: UcdpRow[] = [];
    let complete = false;
    for (let page = 1; page <= 100; page++) {
      params.set("page", String(page));
      const res = await safeFetch("ucdp", `${BASE}/gedevents/${VERSION}?${params.toString()}`, {
        headers: {
          Accept: "application/json",
          "x-ucdp-access-token": process.env.UCDP_ACCESS_TOKEN ?? "",
        },
      });
      const json = (await res.json()) as { Result?: UcdpRow[]; NextPageUrl?: string | null; TotalPages?: number };
      if (!Array.isArray(json.Result)) throw new ConnectorError("Réponse UCDP invalide", "ucdp", "parse");
      rows.push(...json.Result);
      if (json.NextPageUrl === null || (typeof json.TotalPages === "number" && page >= json.TotalPages) || (json.NextPageUrl === undefined && json.Result.length < 1000)) {
        complete = true;
        break;
      }
    }
    if (!complete) throw new ConnectorError("Limite de pagination UCDP atteinte", "ucdp", "parse");

    return rows
      .map((row) => toEvent(row, row.source_article?.startsWith("http") ? row.source_article : "https://ucdp.uu.se/"))
      .filter((e): e is ConflictEvent => e !== null);
  },
};
