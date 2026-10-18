import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Confidence, ConflictEvent, EventType } from "@/types/conflict";
import { hasDemoMarkers } from "../dataPolicy";
import { type Connector, ConnectorError, strictIsoDate } from "./types";

/**
 * Import de fichiers : `data/imports/*.csv`.
 *
 * ACLED et UCDP permettent tous deux l'export CSV depuis leurs portails.
 * C'est la voie d'intégration la plus fiable (aucun identifiant à stocker,
 * aucun quota d'API) : déposez l'export dans `data/imports/` puis lancez
 * `POST /api/ingest`. Les deux formats sont détectés automatiquement.
 *
 * Un fichier compatible n'est pas pour autant un export authentifié : les lignes
 * sont étiquetées `import:csv` (provenance opérateur), jamais `acled`/`ucdp`, et
 * la confiance par défaut est `REPORTED`. Le format ne déduit pas `CONFIRMED` ;
 * seule une colonne `confidence` explicite peut le déclarer (assertion de
 * l'opérateur, tracée dans `source`). Chaque ligne est validée : les rejets sont
 * comptés par motif et rapportés, sans bloquer les lignes valides.
 */

const IMPORT_DIR = () => path.join(process.cwd(), "data", "imports");

/** Parseur CSV minimal respectant les guillemets (RFC 4180). */
export function parseCsv(text: string): Record<string, string>[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM UTF-8
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

export type CsvRejectReason =
  | "donnees_demo"
  | "format_non_reconnu"
  | "coordonnees_manquantes"
  | "coordonnees_invalides"
  | "coordonnees_zero_zero"
  | "date_invalide"
  | "date_future"
  | "morts_invalides";

export interface CsvImportReport {
  file: string;
  format: "acled-compatible" | "ucdp-compatible" | "inconnu";
  rows: number;
  accepted: number;
  rejected: Partial<Record<CsvRejectReason, number>>;
  /** Lignes acceptées dont le nombre de morts était vide (enregistré 0 = inconnu). */
  fatalitiesUnknown: number;
  /** Fichier non lu (encodage, droits…) : aucune ligne n'a été examinée. */
  unreadable?: boolean;
  /** Premiers rejets (numéro de ligne du fichier, motif), pour corriger la source. */
  samples: { line: number; reason: CsvRejectReason }[];
}

const MAX_SAMPLES = 10;
const MIN_YEAR = 1945;

/** Nombre strict : chaîne vide ou non numérique → null (jamais 0 par défaut). */
const strictNumber = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

function parseCoordinates(r: Record<string, string>): { lat: number; lon: number } | CsvRejectReason {
  const rawLat = r.latitude ?? r.lat;
  const rawLon = r.longitude ?? r.lon;
  if (!rawLat?.trim() || !rawLon?.trim()) return "coordonnees_manquantes";
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return "coordonnees_invalides";
  // (0, 0) est la valeur de repli classique des exports : refusée, jamais « corrigée ».
  if (lat === 0 && lon === 0) return "coordonnees_zero_zero";
  return { lat, lon };
}

function parseDate(raw: string | undefined, now: number): { iso: string } | CsvRejectReason {
  const iso = strictIsoDate((raw ?? "").trim());
  if (!iso || Number(iso.slice(0, 4)) < MIN_YEAR) return "date_invalide";
  if (Date.parse(iso) > now + 86400e3) return "date_future";
  return { iso };
}

const DECLARABLE: readonly Confidence[] = ["CONFIRMED", "REPORTED", "MEDIA_SIGNAL"];

/** Confiance : valeur explicite de la colonne `confidence`, sinon REPORTED. Jamais déduite du format. */
function declaredConfidence(r: Record<string, string>): { confidence: Confidence; declared: boolean } {
  const v = (r.confidence ?? "").trim().toUpperCase() as Confidence;
  return DECLARABLE.includes(v) ? { confidence: v, declared: true } : { confidence: "REPORTED", declared: false };
}

const httpUrl = (v: string | undefined): string => {
  try {
    const u = new URL((v ?? "").trim());
    return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.href : "";
  } catch {
    return "";
  }
};

const rowHash = (parts: (string | number)[]) => createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);

/** Valide et normalise un fichier : exporté pour des tests hors dépôt. */
export function importCsvText(text: string, file: string, now = Date.now()): { events: ConflictEvent[]; report: CsvImportReport } {
  const rows = parseCsv(text);
  const has = (k: string) => rows.length > 0 && k in rows[0];
  const isUcdp = has("relid") || has("type_of_violence") || has("deaths_civilians") || has("date_start");
  const isAcled = !isUcdp && (has("event_id_cnty") || has("event_type") || has("event_date"));
  const report: CsvImportReport = {
    file,
    format: isUcdp ? "ucdp-compatible" : isAcled ? "acled-compatible" : "inconnu",
    rows: rows.length,
    accepted: 0,
    rejected: {},
    fatalitiesUnknown: 0,
    samples: [],
  };
  const events: ConflictEvent[] = [];
  const reject = (index: number, reason: CsvRejectReason) => {
    report.rejected[reason] = (report.rejected[reason] ?? 0) + 1;
    if (report.samples.length < MAX_SAMPLES) report.samples.push({ line: index + 2, reason });
  };
  const updatedAt = new Date(now).toISOString();
  const label = isUcdp ? "format UCDP GED" : "format ACLED";

  rows.forEach((r, index) => {
    const hasDemo = hasDemoMarkers({ confidence: r.confidence })
      || [r.id, r.relid, r.event_id_cnty].some((id) => hasDemoMarkers({ id }))
      || [r.source, r.source_headline].some((source) => hasDemoMarkers({ source }))
      || [r.source_dataset, r.sourcedataset, r.dataset].some((sourceDataset) => hasDemoMarkers({ sourceDataset }));
    if (hasDemo) return reject(index, "donnees_demo");
    if (!isUcdp && !isAcled) return reject(index, "format_non_reconnu");
    const coords = parseCoordinates(r);
    if (typeof coords === "string") return reject(index, coords);
    const parsedDate = parseDate(isUcdp ? r.date_start : r.event_date, now);
    if (typeof parsedDate === "string") return reject(index, parsedDate);
    const date = parsedDate.iso;

    const rawDeaths = isUcdp ? (strictNumber(r.best) !== null ? r.best : r.deaths_civilians) : r.fatalities;
    const deaths = strictNumber(rawDeaths);
    if (deaths !== null && (deaths < 0 || !Number.isInteger(deaths))) return reject(index, "morts_invalides");
    if (rawDeaths !== undefined && rawDeaths.trim() !== "" && deaths === null) return reject(index, "morts_invalides");
    if (deaths === null) report.fatalitiesUnknown++;

    const { lat, lon } = coords;
    const { confidence, declared } = declaredConfidence(r);
    const origin = `Import CSV · ${label} · ${file}${declared ? ` · confiance déclarée par le fichier (${confidence})` : ""}`;
    const nativeId = isUcdp ? (r.id || r.relid) : r.event_id_cnty;
    // Sans identifiant natif : empreinte du contenu (et non « lat,lon », qui fusionnait des lignes distinctes).
    const fallbackId = (kind: string) =>
      `csv-${kind}-${rowHash([date, lat, lon, r.country ?? "", r.event_type ?? r.type_of_violence ?? "", deaths ?? "", r.actor1 ?? r.side_a ?? "", r.actor2 ?? r.side_b ?? ""])}`;

    if (isUcdp) {
      const t = strictNumber(r.type_of_violence);
      events.push({
        id: nativeId ? `csv-ucdp-${nativeId}` : fallbackId("ucdp"),
        latitude: lat,
        longitude: lon,
        country: r.country ?? "",
        region: r.region ?? "",
        locality: r.where_description ?? "",
        eventType: t === 3 ? "Violence against civilians" : "Battles",
        subEventType: t === 3 ? "Violence ciblée" : "Affrontement",
        actors: [r.side_a, r.side_b].filter((a): a is string => Boolean(a)),
        fatalities: deaths ?? 0,
        source: r.source_headline ? `${origin} · ${r.source_headline}` : origin,
        sourceUrl: httpUrl(r.source_article),
        sourceDataset: "import:csv",
        confidence,
        eventDate: date,
        updatedAt,
      });
    } else {
      events.push({
        id: nativeId ? `csv-acled-${nativeId}` : fallbackId("acled"),
        latitude: lat,
        longitude: lon,
        country: r.country ?? "",
        region: r.admin1 ?? "",
        locality: r.location ?? "",
        eventType: ACLED_TYPES[(r.event_type ?? "").toLowerCase()] ?? "Strategic developments",
        subEventType: r.sub_event_type ?? "",
        actors: [r.actor1, r.actor2].filter((a): a is string => Boolean(a)),
        fatalities: deaths ?? 0,
        source: r.source ? `${origin} · ${r.source}` : origin,
        sourceUrl: httpUrl(r.source_url ?? r.source_article),
        sourceDataset: "import:csv",
        confidence,
        eventDate: date,
        updatedAt,
      });
    }
    report.accepted++;
  });
  return { events, report };
}

let lastReports: CsvImportReport[] = [];

function summarize(reports: CsvImportReport[]): string | null {
  if (!reports.length) return null;
  return reports
    .map((r) => {
      if (r.unreadable) return `${r.file} illisible (ignoré)`;
      const rej = Object.entries(r.rejected).map(([k, n]) => `${k}: ${n}`);
      const total = Object.values(r.rejected).reduce((a, n) => a + (n ?? 0), 0);
      const unknown = r.fatalitiesUnknown ? `, ${r.fatalitiesUnknown} sans nombre de morts (0 = inconnu)` : "";
      return `${r.file} [${r.format}] ${r.accepted}/${r.rows} acceptées${total ? `, ${total} rejetées (${rej.join(", ")})` : ""}${unknown}`;
    })
    .join(" ; ");
}

export const csvConnector: Connector = {
  id: "csv",
  label: "Import CSV",

  isConfigured() {
    return true; // toujours disponible : dépend seulement des fichiers déposés
  },

  describe() {
    const base = "Déposez un export ACLED ou UCDP (.csv) dans data/imports/ puis lancez une ingestion. Étiqueté « import opérateur », confiance REPORTED par défaut.";
    const last = summarize(lastReports);
    return last ? `${base} Dernier import : ${last}.` : base;
  },

  lastReport() {
    return summarize(lastReports);
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
    const reports: CsvImportReport[] = [];
    let failed = 0;
    for (const file of files) {
      try {
        const text = await readFile(path.join(IMPORT_DIR(), file), "utf8");
        const result = importCsvText(text, file);
        events.push(...result.events);
        reports.push(result.report);
      } catch {
        // Un fichier illisible n'invalide pas les autres : il est rapporté.
        failed++;
        reports.push({ file, format: "inconnu", rows: 0, accepted: 0, rejected: {}, fatalitiesUnknown: 0, unreadable: true, samples: [] });
      }
    }
    lastReports = reports;
    if (failed === files.length) {
      throw new ConnectorError(`import: ${failed} fichier(s) illisible(s)`, "csv", "parse");
    }
    return events;
  },
};
