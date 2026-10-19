import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalCountryIdentity, normalizeCountryName, resolveCountryIdentity } from "@/lib/geo/country";
import { isRecord } from "./common";

let naturalEarthNames: Promise<Map<string, string>> | undefined;

/** Noms anglais OFAC → ISO3 via le référentiel pays déjà utilisé par le globe. */
async function namesFromNaturalEarth(): Promise<Map<string, string>> {
  naturalEarthNames ??= readFile(path.join(process.cwd(), "public/data/ne_110m_countries.geojson"), "utf8").then((body) => {
    const raw: unknown = JSON.parse(body);
    if (!isRecord(raw) || !Array.isArray(raw.features)) throw new Error("Référentiel pays invalide.");
    const map = new Map<string, string>();
    for (const item of raw.features) {
      if (!isRecord(item) || !isRecord(item.properties)) continue;
      const p = item.properties;
      const name = [p.ADMIN, p.NAME, p.NAME_LONG, p.BRK_NAME, p.FORMAL_EN].find((value): value is string => typeof value === "string" && !!value);
      if (!name) continue;
      const identity = canonicalCountryIdentity(name, { isoA3: p.ISO_A3, adm0A3: p.ADM0_A3, sovA3: p.SOV_A3 });
      if (!identity || !/^[A-Z]{3}$/.test(identity.iso3)) continue;
      for (const value of [p.ADMIN, p.NAME, p.NAME_LONG, p.BRK_NAME, p.FORMAL_EN]) {
        if (typeof value === "string" && value) map.set(normalizeCountryName(value), identity.iso3);
      }
    }
    return map;
  }).catch((error) => {
    naturalEarthNames = undefined;
    throw error;
  });
  return naturalEarthNames;
}

const OFAC_ALIASES: Record<string, string> = {
  "congo democratic republic of the": "COD",
  "korea north": "PRK",
  "korea south": "KOR",
  "moldova": "MDA",
  "russia": "RUS",
  "syria": "SYR",
  "taiwan": "TWN",
  "venezuela": "VEN",
};

export async function resolveOfacCountryIso3(country: string): Promise<string | null> {
  const direct = resolveCountryIdentity(country)?.iso3;
  if (direct && /^[A-Z]{3}$/.test(direct)) return direct;
  const key = normalizeCountryName(country);
  return OFAC_ALIASES[key] ?? (await namesFromNaturalEarth()).get(key) ?? null;
}
