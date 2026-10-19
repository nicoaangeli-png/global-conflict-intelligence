import type { LayerFeature } from "@/types/layers";
import { FeedError, fetchBytes } from "@/server/feeds/util";
import { feature } from "./common";
import { resolveOfacCountryIso3 } from "./country";

const SDN_URL = "https://www.treasury.gov/ofac/downloads/sdn.csv";
const ADDRESSES_URL = "https://www.treasury.gov/ofac/downloads/add.csv";
const SDN_EXPORT_URL = "https://sanctionslistservice.ofac.treas.gov/api/publicationpreview/exports/sdn.csv";
/** SDN CSV observé le 19/10/2026 : ~5,8 Mo ; plafond distinct, sans XML de 127 Mo. */
const OFAC_MAX_BYTES = 8 * 1024 * 1024;
const OFAC_TIMEOUT_MS = 30_000;

/** CSV OFAC RFC-4180 (guillemets doublés) ; les lignes invalides sont écartées, jamais devinées. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += char; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field.trim()); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; field = "";
    } else field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parsePrograms(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(/\]\s*\[|[;,]/).map((program) => program.replace(/^\[|\]$/g, "").trim()).filter(Boolean);
}

export async function parseSanctions(sdnCsv: string, addressesCsv: string): Promise<LayerFeature[]> {
  const programsByEntity = new Map<string, string[]>();
  for (const row of parseCsv(sdnCsv)) {
    const id = row[0]?.trim();
    if (!/^\d+$/.test(id)) continue;
    const programs = parsePrograms(row[3]);
    programsByEntity.set(id, programs);
  }
  const countries = new Map<string, { entities: Set<string>; programs: Map<string, number> }>();
  for (const row of parseCsv(addressesCsv)) {
    const id = row[0]?.trim();
    const country = row[4]?.trim();
    if (!id || !country || !programsByEntity.has(id)) continue;
    const iso = await resolveOfacCountryIso3(country);
    if (!iso) continue;
    const entry = countries.get(iso) ?? { entities: new Set<string>(), programs: new Map<string, number>() };
    if (!entry.entities.has(id)) {
      entry.entities.add(id);
      for (const program of programsByEntity.get(id) ?? []) entry.programs.set(program, (entry.programs.get(program) ?? 0) + 1);
    }
    countries.set(iso, entry);
  }
  return [...countries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([iso, totals]) => feature(`sanctions:${iso}`, iso, [iso], null, {
    entityCount: totals.entities.size,
    programs: JSON.stringify(Object.fromEntries([...totals.programs.entries()].sort(([a], [b]) => a.localeCompare(b)))),
  }, "https://sanctionssearch.ofac.treas.gov/"));
}

/** La publication date est extraite de l'URL S3 officielle quand OFAC la fournit ; sinon inconnue. */
export function publicationDateFromUrl(url: string): string | null {
  const match = /\/Published\/[^/]+\/(\d{4}-\d{2}-\d{2})\//.exec(url);
  return match?.[1] ?? null;
}

/** OFAC redirige vers l'objet publié ; son URL signée contient la date officielle de publication. */
async function fetchPublicationDate(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const second = await fetch(SDN_EXPORT_URL, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "ORBITAL/0.2 (contact nicoa.angeli@gmail.com)" },
    });
    const published = second.headers.get("location");
    await second.body?.cancel().catch(() => undefined);
    return published ? publicationDateFromUrl(published) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadSanctions(): Promise<{ features: LayerFeature[]; asOf: string | null }> {
  const [sdn, addresses] = await Promise.all([
    fetchBytes(SDN_URL, { accept: "text/csv", maxBytes: OFAC_MAX_BYTES, timeoutMs: OFAC_TIMEOUT_MS }),
    fetchBytes(ADDRESSES_URL, { accept: "text/csv", maxBytes: OFAC_MAX_BYTES, timeoutMs: OFAC_TIMEOUT_MS }),
  ]);
  const sdnText = new TextDecoder("utf-8").decode(sdn).replace(/^﻿/, "");
  const addressesText = new TextDecoder("utf-8").decode(addresses).replace(/^﻿/, "");
  if (!sdnText || !addressesText) throw new FeedError("OFAC a fourni un CSV vide.");
  return { features: await parseSanctions(sdnText, addressesText), asOf: await fetchPublicationDate() };
}
