import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ConflictEvent, EventType } from "@/types/conflict";
import { type Connector, ConnectorError } from "./types";

/**
 * Import de fichiers : `data/imports/*.csv`.
 *
 * ACLED et UCDP permettent tous deux l'export CSV depuis leurs portails.
 * C'est la voie d'intégration la plus fiable (aucun identifiant à stocker,
 * aucun quota d'API) : déposez l'export dans `data/imports/` puis lancez
 * `POST /api/ingest`. Les deux formats sont détectés automatiquement.
 */

const IMPORT_DIR = () => path.join(process.cwd(), "data", "imports");

/** Parseur CSV minimal respectant les guillemets (RFC 4180). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim().length))
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, i) => {
        obj[h] = (r[i] ?? "").trim();
      });
      return obj;
    });
}

const ACLED_TYPES: Record<string, EventType> = {
  battles: "Battles",
  "explosions/remote violence": "Explosions/Remote violence",
  "violence against civilians": "Violence against civilians",
  riots: "Riots",
  protests: "Protests",
  "strategic developments": "Strategic developments",
};

const num = (v: string | undefined): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Détecte le format d'après l'en-tête et normalise les lignes. */
function normalizeRows(rows: Record<string, string>[], file: string): ConflictEvent[] {
  const has = (k: string) => rows.length > 0 && k in rows[0];
  const isAcled = has("event_id_cnty") || has("event_type");
  const isUcdp = has("relid") || has("type_of_violence") || has("deaths_civilians");
  const out: ConflictEvent[] = [];

  for (const r of rows) {
    const lat = num(r.latitude ?? r.lat);
    const lon = num(r.longitude ?? r.lon);
    if (!lat && !lon) continue;

    if (isUcdp) {
      const t = num(r.type_of_violence);
      out.push({
        id: `ucdp-${r.id ?? `${lat},${lon}`}`,
        latitude: lat,
        longitude: lon,
        country: r.country ?? "",
        region: r.region ?? "",
        locality: r.where_description ?? "",
        eventType: t === 3 ? "Violence against civilians" : "Battles",
        subEventType: t === 3 ? "Violence ciblée" : "Affrontement",
        actors: [r.side_a, r.side_b].filter((a): a is string => Boolean(a)),
        fatalities: num(r.best ?? r.deaths_civilians),
        source: r.source_headline ? `UCDP · ${r.source_headline}` : `UCDP GED (${file})`,
        sourceUrl: r.source_article ?? "",
        sourceDataset: "ucdp",
        confidence: "REPORTED",
        eventDate: new Date(`${(r.date_start ?? "").slice(0, 10)}T12:00:00Z`).toISOString(),
        updatedAt: new Date().toISOString(),
      });
      continue;
    }

    if (isAcled) {
      out.push({
        id: `acled-${r.event_id_cnty ?? `${lat},${lon},${r.event_date ?? ""}`}`,
        latitude: lat,
        longitude: lon,
        country: r.country ?? "",
        region: r.admin1 ?? "",
        locality: r.location ?? "",
        eventType: ACLED_TYPES[(r.event_type ?? "").toLowerCase()] ?? "Strategic developments",
        subEventType: r.sub_event_type ?? "",
        actors: [r.actor1, r.actor2].filter((a): a is string => Boolean(a)),
        fatalities: num(r.fatalities),
        source: r.source ? `ACLED · ${r.source}` : `ACLED (${file})`,
        sourceUrl: "",
        sourceDataset: "acled",
        confidence: "CONFIRMED",
        eventDate: new Date(`${(r.event_date ?? "").slice(0, 10)}T12:00:00Z`).toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }
  return out;
}

export const csvConnector: Connector = {
  id: "csv",
  label: "Import CSV",

  isConfigured() {
    return true; // toujours disponible : dépend seulement des fichiers déposés
  },

  describe() {
    return "Déposez un export ACLED ou UCDP (.csv) dans data/imports/ puis lancez une ingestion.";
  },

  async fetchEvents() {
    let files: string[] = [];
    try {
      files = (await readdir(IMPORT_DIR())).filter((f) => f.toLowerCase().endsWith(".csv"));
    } catch {
      return [];
    }
    if (!files.length) return [];

    const events: ConflictEvent[] = [];
    for (const file of files) {
      try {
        const text = await readFile(path.join(IMPORT_DIR(), file), "utf8");
        events.push(...normalizeRows(parseCsv(text), file));
      } catch (err) {
        throw new ConnectorError(
          `import ${file}: ${err instanceof Error ? err.message : "lecture impossible"}`,
          "csv",
          "parse",
        );
      }
    }
    return events;
  },
};
