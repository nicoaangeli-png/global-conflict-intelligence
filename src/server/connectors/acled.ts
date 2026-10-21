import "server-only";
import type { ConflictEvent, EventType } from "@/types/conflict";
import { ConnectorError, type Connector, env, safeFetch, providerDate, validCoordinates } from "./types";

/**
 * Connecteur ACLED (source principale).
 *
 * ACLED utilise OAuth2 « password grant » depuis 2025 :
 *   POST https://acleddata.com/oauth/token
 *   GET  https://acleddata.com/api/acled/read
 * Les identifiants restent strictement côté serveur : aucun jeton n'est
 * exposé au navigateur, et l'interface n'affiche que l'état du connecteur.
 */

const TOKEN_URL = "https://acleddata.com/oauth/token";
const API_URL = "https://acleddata.com/api/acled/read";

const ACLED_TYPES: Record<string, EventType> = {
  Battles: "Battles",
  "Explosions/Remote violence": "Explosions/Remote violence",
  "Violence against civilians": "Violence against civilians",
  Riots: "Riots",
  Protests: "Protests",
  "Strategic developments": "Strategic developments",
};

interface AcledRow {
  event_id_cnty?: string;
  event_date?: string;
  event_type?: string;
  sub_event_type?: string;
  actor1?: string;
  actor2?: string;
  country?: string;
  admin1?: string;
  location?: string;
  latitude?: string | number;
  longitude?: string | number;
  fatalities?: string | number;
  source?: string;
  timestamp?: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  const direct = env("ACLED_ACCESS_TOKEN");
  if (direct) return direct;

  const email = env("ACLED_EMAIL");
  const password = env("ACLED_PASSWORD");
  if (!email || !password) {
    throw new ConnectorError("identifiants ACLED absents (ACLED_EMAIL / ACLED_PASSWORD)", "acled", "config");
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const body = new URLSearchParams({
    username: email,
    password,
    grant_type: "password",
    client_id: "acled",
  });
  const res = await safeFetch("acled", TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new ConnectorError("jeton ACLED refusé", "acled", "config");
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

export const acledConnector: Connector = {
  id: "acled",
  label: "ACLED",

  isConfigured() {
    return process.env.ACLED_DISABLED !== "1" && Boolean(env("ACLED_ACCESS_TOKEN") || (env("ACLED_EMAIL") && env("ACLED_PASSWORD")));
  },

  describe() {
    return this.isConfigured()
      ? "Identifiants détectés — interrogation de l'API ACLED."
      : "Non configuré. Renseignez ACLED_EMAIL / ACLED_PASSWORD dans .env.local.";
  },

  async fetchEvents({ days }) {
    if (!this.isConfigured()) throw new ConnectorError("ACLED non configuré", "acled", "config");
    const token = await getToken();
    const from = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
    const params = new URLSearchParams({
      event_date: `${from}|${new Date().toISOString().slice(0, 10)}`,
      event_date_where: "BETWEEN",
      limit: "5000",
      fields: [
        "event_id_cnty",
        "event_date",
        "event_type",
        "sub_event_type",
        "actor1",
        "actor2",
        "country",
        "admin1",
        "location",
        "latitude",
        "longitude",
        "fatalities",
        "source",
        "timestamp",
      ].join("|"),
    });

    const rows: AcledRow[] = [];
    let complete = false;
    for (let page = 1; page <= 20; page++) {
      params.set("page", String(page));
      const res = await safeFetch("acled", `${API_URL}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const json = (await res.json()) as { data?: AcledRow[]; error?: unknown; success?: boolean };
      if (json.error || json.success === false || !Array.isArray(json.data)) {
        throw new ConnectorError("Réponse ACLED invalide", "acled", "parse");
      }
      rows.push(...json.data);
      if (json.data.length < 5000) { complete = true; break; }
    }
    if (!complete) throw new ConnectorError("Limite de pagination ACLED atteinte", "acled", "parse");

    return rows
      .map((row): ConflictEvent | null => {
        const lat = n(row.latitude);
        const lon = n(row.longitude);
        if (!validCoordinates(row.latitude, row.longitude)) return null;
        const date = providerDate(row.event_date);
        if (!date || !row.event_id_cnty) return null;
        return {
          id: `acled-${row.event_id_cnty ?? `${lat},${lon},${date}`}`,
          latitude: lat,
          longitude: lon,
          country: row.country ?? "",
          region: row.admin1 ?? "",
          locality: row.location ?? "",
          eventType: ACLED_TYPES[row.event_type ?? ""] ?? "Strategic developments",
          subEventType: row.sub_event_type ?? "",
          actors: [row.actor1, row.actor2].filter((a): a is string => Boolean(a)),
          fatalities: Math.max(0, Math.trunc(n(row.fatalities))),
          source: row.source ? `ACLED · ${row.source}` : "ACLED",
          sourceUrl: "",
          sourceDataset: "acled",
          confidence: "CONFIRMED",
          eventDate: date,
          updatedAt: row.timestamp && /^\d{10}$/.test(row.timestamp)
            ? new Date(Number(row.timestamp) * 1000).toISOString()
            : providerDate(row.timestamp) ?? new Date().toISOString(),
        };
      })
      .filter((e): e is ConflictEvent => e !== null);
  },
};
