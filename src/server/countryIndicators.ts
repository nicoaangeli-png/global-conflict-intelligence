import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CountryLeaders } from "./leaders";

export type CountryIndicator = {
  value: number | null;
  year: number | null;
  sourceUrl: string;
  status: "available" | "unavailable" | "error";
};

export type CountryIndicators = {
  iso: string;
  population: CountryIndicator;
  gdp: CountryIndicator;
  /** Ajouté par la route `/api/country` (Wikidata). */
  leaders?: CountryLeaders;
};

const SUCCESS_TTL = 24 * 60 * 60 * 1000;
const FAILURE_TTL = 60 * 1000;
const TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const cache = new Map<string, { expiresAt: number; result: CountryIndicator }>();
const pending = new Map<string, Promise<CountryIndicator>>();
let countryCodes: Promise<Set<string>> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getCountryCodes(): Promise<Set<string>> {
  if (!countryCodes) {
    countryCodes = readFile(path.join(process.cwd(), "public/data/ne_110m_countries.geojson"), "utf8")
      .then((text) => {
        const data: unknown = JSON.parse(text);
        if (!isRecord(data) || !Array.isArray(data.features)) throw new Error("Invalid country referential");
        const codes = new Set<string>();
        for (const feature of data.features) {
          if (!isRecord(feature) || !isRecord(feature.properties)) continue;
          const properties = feature.properties;
          const code = ["ISO_A3", "ADM0_A3", "iso_a3", "ISO_A2"]
            .map((key) => properties[key])
            .find((value) => typeof value === "string" && /^[A-Z]{3}$/.test(value));
          if (typeof code === "string" && /^[A-Z]{3}$/.test(code)) codes.add(code);
        }
        return codes;
      })
      .catch((error: unknown) => {
        countryCodes = undefined;
        throw error;
      });
  }
  return countryCodes;
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (contentLength > MAX_RESPONSE_BYTES || !response.body) throw new Error("Invalid response size");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Response too large");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function fetchIndicator(iso: string, indicator: string, sourceUrl: string): Promise<CountryIndicator> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("World Bank request failed");
    }
    const data = await readLimitedJson(response);
    if (!Array.isArray(data) || data.length !== 2 || !isRecord(data[0]) || "message" in data[0]) {
      throw new Error("Invalid World Bank response");
    }
    const rows: unknown = data[1];
    if (rows !== null && !Array.isArray(rows)) throw new Error("Invalid indicator rows");
    let latest: CountryIndicator = { value: null, year: null, sourceUrl, status: "unavailable" };
    for (const row of rows ?? []) {
      if (!isRecord(row) || row.countryiso3code !== iso || !isRecord(row.indicator) || row.indicator.id !== indicator) {
        throw new Error("Unexpected indicator identity");
      }
      if (row.value === null) continue;
      if (typeof row.value !== "number" || !Number.isFinite(row.value) || typeof row.date !== "string" || !/^\d{4}$/.test(row.date)) {
        throw new Error("Invalid annual indicator value");
      }
      const year = Number(row.date);
      if (latest.year === null || year > latest.year) {
        latest = { value: row.value, year, sourceUrl, status: "available" };
      }
    }
    return latest;
  } catch {
    return { value: null, year: null, sourceUrl, status: "error" };
  } finally {
    clearTimeout(timeout);
  }
}

function getIndicator(iso: string, indicator: string): Promise<CountryIndicator> {
  const sourceUrl = `https://api.worldbank.org/v2/country/${iso}/indicator/${indicator}?format=json&per_page=1&mrnev=1&source=2`;
  const cached = cache.get(sourceUrl);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve({ ...cached.result });
  const existing = pending.get(sourceUrl);
  if (existing) return existing.then((result) => ({ ...result }));
  const request = fetchIndicator(iso, indicator, sourceUrl).then((result) => {
    cache.set(sourceUrl, {
      expiresAt: Date.now() + (result.status === "available" ? SUCCESS_TTL : FAILURE_TTL),
      result,
    });
    return result;
  }).finally(() => pending.delete(sourceUrl));
  pending.set(sourceUrl, request);
  return request.then((result) => ({ ...result }));
}

export async function getCountryIndicators(iso: string): Promise<CountryIndicators | null> {
  if (!/^[A-Z]{3}$/.test(iso) || !(await getCountryCodes()).has(iso)) return null;
  const [population, gdp] = await Promise.all([
    getIndicator(iso, "SP.POP.TOTL"),
    getIndicator(iso, "NY.GDP.MKTP.CD"),
  ]);
  return { iso, population, gdp };
}
