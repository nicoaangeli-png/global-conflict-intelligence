/** Canonical country identity used by the UI and Natural Earth reference. */
export interface CountryIdentity {
  iso3: string;
  name: string;
}

const COUNTRIES: Record<string, { name: string; aliases: string[] }> = {
  USA: { name: "United States of America", aliases: ["United States", "United States of America", "USA", "US", "US1", "America", "États-Unis", "Etats-Unis"] },
  COD: { name: "Democratic Republic of the Congo", aliases: ["DR Congo", "DRC", "Democratic Republic of the Congo", "Democratic Republic of Congo", "Dem. Rep. Congo", "Congo, Dem. Rep.", "Congo-Kinshasa", "Congo, Democratic Republic of the", "CD"] },
  COG: { name: "Republic of the Congo", aliases: ["Republic of the Congo", "Republic of Congo", "Congo-Brazzaville", "CG"] },
  AFG: { name: "Afghanistan", aliases: ["Afghanistan"] },
  PAK: { name: "Pakistan", aliases: ["Pakistan"] },
  YEM: { name: "Yemen", aliases: ["Yemen"] },
  FRA: { name: "France", aliases: ["France", "FR", "FR1"] },
  IRN: { name: "Iran", aliases: ["Iran", "Islamic Republic of Iran", "IR"] },
  GBR: { name: "United Kingdom", aliases: ["United Kingdom", "UK", "GB", "Great Britain"] },
  RUS: { name: "Russia", aliases: ["Russia", "Russian Federation", "Russie"] },
  CHN: { name: "China", aliases: ["China", "People's Republic of China", "Chine"] },
  MMR: { name: "Myanmar", aliases: ["Myanmar", "Burma", "Birmanie"] },
  LAO: { name: "Laos", aliases: ["Laos", "Lao PDR"] },
  ISR: { name: "Israel", aliases: ["Israel", "Israël"] },
  PSE: { name: "Palestine", aliases: ["Palestine", "State of Palestine"] },
  UKR: { name: "Ukraine", aliases: ["Ukraine"] },
  TWN: { name: "Taiwan", aliases: ["Taiwan", "Taïwan"] },
  LBN: { name: "Lebanon", aliases: ["Lebanon", "Liban"] },
  SDN: { name: "Sudan", aliases: ["Sudan", "Soudan"] },
  SYR: { name: "Syria", aliases: ["Syria", "Syrie"] },
  KOS: { name: "Kosovo", aliases: ["Kosovo"] },
};

const NORMALIZED = new Map<string, CountryIdentity>();
for (const [iso3, country] of Object.entries(COUNTRIES)) {
  const identity = { iso3, name: country.name };
  for (const alias of [iso3, country.name, ...country.aliases]) NORMALIZED.set(normalize(alias), identity);
}

// Natural Earth may publish a non-ISO ADM0_A3/SOV_A3 value when ISO_A3 is -99.
const PROVIDER_CODES: Record<"natural-earth" | "fips" | "cameo", Record<string, string>> = {
  "natural-earth": { FR1: "FRA", US1: "USA", KOS: "KOS" },
  // FIPS 10-4 values are accepted only through this explicit provider table.
  fips: { US: "USA", CG: "COD", CF: "COG", IR: "IRN", FR: "FRA", UK: "GBR" },
  // No numeric CAMEO country-code crosswalk is currently verified in this UI.
  cameo: {},
};

export function normalizeCountryName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Generic Congo is intentionally unresolved because it can mean COD or COG. */
export function countryNamesMatchWhenIsoUnknown(left: string, right: string): boolean {
  const leftKey = normalize(left);
  const rightKey = normalize(right);
  if (!leftKey || leftKey !== rightKey || leftKey === "congo") return false;
  return true;
}

function normalize(value: string): string {
  return normalizeCountryName(value);
}

export function resolveCountryIdentity(value: string, provider?: "natural-earth" | "fips" | "cameo"): CountryIdentity | null {
  const key = normalize(value);
  const mappedCode = provider ? PROVIDER_CODES[provider][value.toUpperCase()] : undefined;
  const mapped = (mappedCode && NORMALIZED.get(normalize(mappedCode))) || NORMALIZED.get(key);
  if (mapped) return mapped;
  return /^[A-Z]{3}$/.test(value) ? { iso3: value, name: value } : null;
}

/** Resolve aliases, ISO3, and the Natural Earth fallback fields to one ISO3. */
export function canonicalCountryIdentity(
  name: string,
  codes: { isoA3?: unknown; adm0A3?: unknown; sovA3?: unknown } = {},
): CountryIdentity | null {
  const candidates = [codes.isoA3, codes.adm0A3, codes.sovA3, name];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate || candidate === "-99") continue;
    const identity = resolveCountryIdentity(candidate, "natural-earth") ?? resolveCountryIdentity(candidate);
    if (identity) {
      return /^[A-Z]{3}$/.test(candidate) && identity.name === candidate
        ? { iso3: identity.iso3, name }
        : identity;
    }
    if (/^[A-Z]{3}$/.test(candidate)) return { iso3: candidate, name };
  }
  return null;
}
