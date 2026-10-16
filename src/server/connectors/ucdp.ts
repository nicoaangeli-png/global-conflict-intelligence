import type { ConflictEvent, EventType } from "@/types/conflict";
import { type Connector, safeFetch } from "./types";

/**
 * Connecteur UCDP (Georeferenced Event Dataset).
 *
 * Base de recherche académique (Uppsala universitet) : sert à l'analyse
 * historique et à la contextualisation. Version d'API et fenêtre
 * configurables par variables d'environnement.
 */

const BASE = "https://ucdpapi.pcr.uu.se/api";
const VERSION = process.env.UCDP_VERSION ?? "25.1";

/** `type_of_violence` UCDP → classification interne. */
const UCDP_TYPES: Record<number, EventType> = {
  1: "Battles",
  2: "Battles",
  3: "Violence against civilians",
};

interface UcdpRow {
  id?: number;
  relid?: string;
  date_start?: string;
  country?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
  type_of_violence?: number;
  side_a?: string;
  side_b?: string;
  deaths_civilians?: number;
  best?: number;
  source_headline?: string;
  source_article?: string;
  where_description?: string;
}

export const ucdpConnector: Connector = {
  id: "ucdp",
  label: "UCDP GED",

  isConfigured() {
    // L'API UCDP exige un jeton d'accès (gratuit, sur demande à l'université
    // d'Uppsala). Sans jeton, le connecteur reste inactif : aucun appel inutile.
    return process.env.UCDP_DISABLED !== "1" && Boolean(process.env.UCDP_ACCESS_TOKEN);
  },

  describe() {
    return process.env.UCDP_ACCESS_TOKEN
      ? `API UCDP GED ${VERSION} — jeu de données académique géoréférencé (validation).`
      : `UCDP GED ${VERSION} — jeton requis (UCDP_ACCESS_TOKEN).`;
  },

  async fetchEvents({ days }) {
    const start = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
    const params = new URLSearchParams({ pagesize: "1000", StartDate: start });
    const res = await safeFetch("ucdp", `${BASE}/gedevents/${VERSION}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "x-ucdp-access-token": process.env.UCDP_ACCESS_TOKEN ?? "",
      },
    });
    const json = (await res.json()) as { Result?: UcdpRow[] };

    return (json.Result ?? [])
      .map((row): ConflictEvent | null => {
        if (typeof row.latitude !== "number" || typeof row.longitude !== "number") return null;
        const date = row.date_start ?? new Date().toISOString().slice(0, 10);
        return {
          id: `ucdp-${row.id ?? `${row.latitude},${row.longitude},${date}`}`,
          latitude: row.latitude,
          longitude: row.longitude,
          country: row.country ?? "",
          region: row.region ?? "",
          locality: row.where_description ?? "",
          eventType: UCDP_TYPES[row.type_of_violence ?? 1] ?? "Battles",
          subEventType: row.type_of_violence === 3 ? "Violence ciblée" : "Affrontement",
          actors: [row.side_a, row.side_b].filter((a): a is string => Boolean(a)),
          fatalities: row.best ?? row.deaths_civilians ?? 0,
          source: row.source_headline ? `UCDP · ${row.source_headline}` : "UCDP GED",
          sourceUrl: row.source_article ?? "",
          sourceDataset: "ucdp",
          confidence: "REPORTED",
          eventDate: new Date(`${date}T12:00:00Z`).toISOString(),
          updatedAt: new Date().toISOString(),
        };
      })
      .filter((e): e is ConflictEvent => e !== null);
  },
};
