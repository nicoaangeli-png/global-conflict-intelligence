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

/**
 * FIPS 10-4 → ISO3 : table COMPLÈTE des codes pays/territoires FIPS 10-4 (celle
 * qu'utilise GDELT pour `ActionGeo_CountryCode`). Pièges : UK=GBR, GM=DEU,
 * RS=RUS, UP=UKR, SP=ESP, CH=CHN, IS=ISR, SZ=CHE, AU=AUT, AS=AUS, BU=BGR,
 * CG=COD (RDC) et CF=COG (Congo-Brazzaville), KN=PRK et KS=KOR.
 * Les territoires sans code ISO3 propre sont rattachés à leur souveraineté ou à
 * UMI (îles mineures des États-Unis, pour Baker, Howland, Jarvis, Johnston,
 * Kingman, Midway, Navassa, Palmyra, Wake) ; les zones contestées sans
 * ISO3 (îles Paracels PF, Spratleys PG, Kouriles PJ) sont volontairement
 * ABSENTES : le pays reste inconnu plutôt qu'attribué par défaut.
 */
export const FIPS_TO_ISO3: Readonly<Record<string, string>> = {
  AA: "ABW", AC: "ATG", AE: "ARE", AF: "AFG", AG: "DZA", AJ: "AZE", AL: "ALB", AM: "ARM", AN: "AND", AO: "AGO",
  AQ: "ASM", AR: "ARG", AS: "AUS", AT: "AUS", AU: "AUT", AV: "AIA", AX: "GBR", AY: "ATA",
  BA: "BHR", BB: "BRB", BC: "BWA", BD: "BMU", BE: "BEL", BF: "BHS", BG: "BGD", BH: "BLZ", BK: "BIH", BL: "BOL",
  BM: "MMR", BN: "BEN", BO: "BLR", BP: "SLB", BQ: "UMI", BR: "BRA", BS: "ATF", BT: "BTN", BU: "BGR", BV: "BVT",
  BX: "BRN", BY: "BDI",
  CA: "CAN", CB: "KHM", CD: "TCD", CE: "LKA", CF: "COG", CG: "COD", CH: "CHN", CI: "CHL", CJ: "CYM", CK: "CCK",
  CM: "CMR", CN: "COM", CO: "COL", CQ: "MNP", CR: "AUS", CS: "CRI", CT: "CAF", CU: "CUB", CV: "CPV", CW: "COK",
  CY: "CYP",
  DA: "DNK", DJ: "DJI", DO: "DMA", DQ: "UMI", DR: "DOM", DX: "GBR",
  EC: "ECU", EG: "EGY", EI: "IRL", EK: "GNQ", EN: "EST", ER: "ERI", ES: "SLV", ET: "ETH", EU: "ATF", EZ: "CZE",
  FG: "GUF", FI: "FIN", FJ: "FJI", FK: "FLK", FM: "FSM", FO: "FRO", FP: "PYF", FQ: "UMI", FR: "FRA", FS: "ATF",
  GA: "GMB", GB: "GAB", GG: "GEO", GH: "GHA", GI: "GIB", GJ: "GRD", GK: "GGY", GL: "GRL", GM: "DEU", GO: "ATF",
  GP: "GLP", GQ: "GUM", GR: "GRC", GT: "GTM", GV: "GIN", GY: "GUY", GZ: "PSE",
  HA: "HTI", HK: "HKG", HM: "HMD", HO: "HND", HQ: "UMI", HR: "HRV", HU: "HUN",
  IC: "ISL", ID: "IDN", IM: "IMN", IN: "IND", IO: "IOT", IP: "FRA", IR: "IRN", IS: "ISR", IT: "ITA", IV: "CIV",
  IZ: "IRQ",
  JA: "JPN", JE: "JEY", JM: "JAM", JN: "SJM", JO: "JOR", JQ: "UMI", JU: "ATF",
  KE: "KEN", KG: "KGZ", KN: "PRK", KQ: "UMI", KR: "KIR", KS: "KOR", KT: "CXR", KU: "KWT", KV: "KOS", KZ: "KAZ",
  LA: "LAO", LE: "LBN", LG: "LVA", LH: "LTU", LI: "LBR", LO: "SVK", LQ: "UMI", LS: "LIE", LT: "LSO", LU: "LUX",
  LY: "LBY",
  MA: "MDG", MB: "MTQ", MC: "MAC", MD: "MDA", MF: "MYT", MG: "MNG", MH: "MSR", MI: "MWI", MJ: "MNE", MK: "MKD",
  ML: "MLI", MN: "MCO", MO: "MAR", MP: "MUS", MQ: "UMI", MR: "MRT", MT: "MLT", MU: "OMN", MV: "MDV", MX: "MEX",
  MY: "MYS", MZ: "MOZ",
  NC: "NCL", NE: "NIU", NF: "NFK", NG: "NER", NH: "VUT", NI: "NGA", NL: "NLD", NN: "SXM", NO: "NOR", NP: "NPL",
  NR: "NRU", NS: "SUR", NT: "NLD", NU: "NIC", NZ: "NZL",
  OD: "SSD",
  PA: "PRY", PC: "PCN", PE: "PER", PK: "PAK", PL: "POL", PM: "PAN", PO: "PRT", PP: "PNG", PS: "PLW", PU: "GNB",
  QA: "QAT",
  RE: "REU", RI: "SRB", RM: "MHL", RN: "MAF", RO: "ROU", RP: "PHL", RQ: "PRI", RS: "RUS", RW: "RWA",
  SA: "SAU", SB: "SPM", SC: "KNA", SE: "SYC", SF: "ZAF", SG: "SEN", SH: "SHN", SI: "SVN", SL: "SLE", SM: "SMR",
  SN: "SGP", SO: "SOM", SP: "ESP", ST: "LCA", SU: "SDN", SV: "SJM", SW: "SWE", SX: "SGS", SY: "SYR", SZ: "CHE",
  TB: "BLM", TD: "TTO", TE: "ATF", TH: "THA", TI: "TJK", TK: "TCA", TL: "TKL", TN: "TON", TO: "TGO", TP: "STP",
  TS: "TUN", TT: "TLS", TU: "TUR", TV: "TUV", TW: "TWN", TX: "TKM", TZ: "TZA",
  UC: "CUW", UG: "UGA", UK: "GBR", UP: "UKR", US: "USA", UV: "BFA", UY: "URY", UZ: "UZB",
  VC: "VCT", VE: "VEN", VI: "VGB", VM: "VNM", VQ: "VIR", VT: "VAT",
  WA: "NAM", WE: "PSE", WF: "WLF", WI: "ESH", WQ: "UMI", WS: "WSM", WZ: "SWZ",
  YI: "SRB", YM: "YEM",
  ZA: "ZMB", ZI: "ZWE",
};

/** Code pays FIPS 10-4 (GDELT) → ISO3, ou null si absent de la table (jamais deviné). */
export function fipsToIso3(code: string | null | undefined): string | null {
  if (!code) return null;
  return FIPS_TO_ISO3[code.trim().toUpperCase()] ?? null;
}

// Natural Earth may publish a non-ISO ADM0_A3/SOV_A3 value when ISO_A3 is -99.
const PROVIDER_CODES: Record<"natural-earth" | "fips" | "cameo", Record<string, string>> = {
  "natural-earth": { FR1: "FRA", US1: "USA", KOS: "KOS" },
  // FIPS 10-4 values are accepted only through this explicit provider table.
  fips: FIPS_TO_ISO3,
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
  // Code fournisseur connu : on ne retombe jamais sur un alias de nom (« SP », « GM »…).
  if (mappedCode) return NORMALIZED.get(normalize(mappedCode)) ?? { iso3: mappedCode, name: mappedCode };
  const mapped = NORMALIZED.get(key);
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
