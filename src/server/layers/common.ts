import type { LayerFeature, LayerGeometry } from "@/types/layers";
import { FeedError, decodeEntities, fetchJson } from "@/server/feeds/util";

export type WikidataBinding = Record<string, { value?: unknown } | undefined>;

export const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? decodeEntities(value).trim() : null;
}

export function binding(binding: WikidataBinding, key: string): string | null {
  return text(binding[key]?.value);
}

/** WKT POINT(lon lat) Wikidata → GeoJSON, sans arrondi inventé. */
export function pointFromWkt(value: string | null): LayerGeometry | null {
  const match = /^Point\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i.exec(value ?? "");
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90
    ? { type: "Point", coordinates: [lon, lat] }
    : null;
}

export function wikidataId(uri: string | null): string | null {
  const id = uri?.split("/").pop() ?? "";
  return /^Q\d+$/.test(id) ? id : null;
}

export function iso3(value: string | null): string | null {
  return value && /^[A-Z]{3}$/.test(value) ? value : null;
}

export function dateOnly(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

export function beforeOrToday(date: string | null, nowMs: number): boolean {
  if (!date) return false;
  const parsed = Date.parse(date);
  return Number.isFinite(parsed) && parsed <= nowMs;
}

/** Requête SPARQL bornée ; fetchJson apporte User-Agent ORBITAL, délai et plafond. */
export async function fetchSparql(query: string, maxBytes = 5 * 1024 * 1024, timeoutMs = 10_000): Promise<WikidataBinding[]> {
  const url = `${WIKIDATA_ENDPOINT}?${new URLSearchParams({ query, format: "json" }).toString()}`;
  const json = await fetchJson<unknown>(url, { accept: "application/sparql-results+json", maxBytes, timeoutMs });
  if (!isRecord(json) || !isRecord(json.results) || !Array.isArray(json.results.bindings)) {
    throw new FeedError("Wikidata a renvoyé un format SPARQL inattendu.");
  }
  return json.results.bindings.filter(isRecord) as WikidataBinding[];
}

export function feature(id: string, name: string, countries: string[], geometry: LayerGeometry | null, properties: LayerFeature["properties"], url: string | null): LayerFeature {
  return { id, name, countries, geometry, properties, url };
}
