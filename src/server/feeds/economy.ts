import type { FeedSeverity, LiveItem } from "@/types/feeds";
import { FeedError, fetchJson, mapLimit, sleep, toIso, type FeedContext, type FeedSourceDef } from "./util";

// ---------------------------------------------------------------------------
// Devises : Frankfurter (taux de référence de la BCE)
// ---------------------------------------------------------------------------

// Pays émetteur de chaque devise (l'euro est partagé : aucun pays unique).
const CURRENCY_COUNTRY: Record<string, { iso3: string; name: string }> = {
  AUD: { iso3: "AUS", name: "dollar australien" },
  BRL: { iso3: "BRA", name: "réal brésilien" },
  CAD: { iso3: "CAN", name: "dollar canadien" },
  CHF: { iso3: "CHE", name: "franc suisse" },
  CNY: { iso3: "CHN", name: "yuan renminbi" },
  CZK: { iso3: "CZE", name: "couronne tchèque" },
  DKK: { iso3: "DNK", name: "couronne danoise" },
  GBP: { iso3: "GBR", name: "livre sterling" },
  HKD: { iso3: "HKG", name: "dollar de Hong Kong" },
  HUF: { iso3: "HUN", name: "forint hongrois" },
  IDR: { iso3: "IDN", name: "roupie indonésienne" },
  ILS: { iso3: "ISR", name: "shekel israélien" },
  INR: { iso3: "IND", name: "roupie indienne" },
  ISK: { iso3: "ISL", name: "couronne islandaise" },
  JPY: { iso3: "JPN", name: "yen japonais" },
  KRW: { iso3: "KOR", name: "won sud-coréen" },
  MXN: { iso3: "MEX", name: "peso mexicain" },
  MYR: { iso3: "MYS", name: "ringgit malaisien" },
  NOK: { iso3: "NOR", name: "couronne norvégienne" },
  NZD: { iso3: "NZL", name: "dollar néo-zélandais" },
  PHP: { iso3: "PHL", name: "peso philippin" },
  PLN: { iso3: "POL", name: "zloty polonais" },
  RON: { iso3: "ROU", name: "leu roumain" },
  SEK: { iso3: "SWE", name: "couronne suédoise" },
  SGD: { iso3: "SGP", name: "dollar de Singapour" },
  THB: { iso3: "THA", name: "baht thaïlandais" },
  TRY: { iso3: "TUR", name: "livre turque" },
  USD: { iso3: "USA", name: "dollar américain" },
  ZAR: { iso3: "ZAF", name: "rand sud-africain" },
};

interface FrankfurterSeries {
  base?: string;
  rates?: Record<string, Record<string, number>>;
}

const trend = (pct: number): string => `${pct >= 0 ? "+" : ""}${pct.toFixed(2)} %`;

function moveSeverity(pct: number): FeedSeverity {
  const abs = Math.abs(pct);
  if (abs >= 5) return "extreme";
  if (abs >= 3) return "severe";
  if (abs >= 1.5) return "moderate";
  return "info";
}

/** Série EUR→devise de la BCE : une cotation par devise, variation entre les deux derniers fixings. */
export function parseFrankfurter(raw: unknown, ctx: FeedContext): LiveItem[] {
  const series = raw as FrankfurterSeries | null;
  const days = Object.keys(series?.rates ?? {}).sort();
  if (series?.base !== "EUR" || days.length < 1) throw new FeedError("Frankfurter : format de réponse inattendu.");
  const last = days[days.length - 1];
  const before = days.length > 1 ? days[days.length - 2] : null;
  const items: LiveItem[] = [];
  for (const [code, rate] of Object.entries(series.rates?.[last] ?? {})) {
    const previous = before ? series.rates?.[before]?.[code] : undefined;
    const pct = typeof previous === "number" && previous !== 0 ? ((rate - previous) / previous) * 100 : null;
    const currency = CURRENCY_COUNTRY[code];
    items.push({
      id: `ecb-fx:${code}:${last}`,
      category: "economy",
      nature: "market_quote",
      title: `EUR/${code} : ${rate}${pct !== null ? ` (${trend(pct)})` : ""}`,
      summary: `1 euro = ${rate} ${code}${currency ? ` (${currency.name})` : ""} au fixing de la BCE du ${last}${before && pct !== null ? `, contre ${previous} le ${before}` : ""}.`,
      url: "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html",
      sourceId: "ecb-fx",
      sourceName: "BCE via Frankfurter",
      publishedAt: toIso(`${last}T14:15:00Z`),
      occurredAt: toIso(`${last}T14:15:00Z`),
      fetchedAt: ctx.fetchedAt,
      countries: currency ? [currency.iso3] : [],
      lat: null,
      lon: null,
      severity: pct !== null ? moveSeverity(pct) : null,
      metric: pct !== null ? { label: "Variation vs fixing précédent", value: Number(pct.toFixed(3)), unit: "%" } : null,
      caveat: "Taux de référence de la BCE (fixing quotidien vers 16 h CET), pas un cours temps réel de marché.",
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Indices boursiers nationaux : Yahoo Finance (source non officielle)
// ---------------------------------------------------------------------------

export const STOCK_INDICES: Array<{ iso3: string; symbol: string; name: string }> = [
  { iso3: "FRA", symbol: "^FCHI", name: "CAC 40" },
  { iso3: "DEU", symbol: "^GDAXI", name: "DAX" },
  { iso3: "GBR", symbol: "^FTSE", name: "FTSE 100" },
  { iso3: "USA", symbol: "^GSPC", name: "S&P 500" },
  { iso3: "JPN", symbol: "^N225", name: "Nikkei 225" },
  { iso3: "CHN", symbol: "000001.SS", name: "SSE Composite" },
  { iso3: "HKG", symbol: "^HSI", name: "Hang Seng" },
  { iso3: "IND", symbol: "^BSESN", name: "BSE Sensex" },
  { iso3: "BRA", symbol: "^BVSP", name: "Ibovespa" },
  { iso3: "CAN", symbol: "^GSPTSE", name: "S&P/TSX" },
  { iso3: "AUS", symbol: "^AXJO", name: "S&P/ASX 200" },
  { iso3: "KOR", symbol: "^KS11", name: "KOSPI" },
  { iso3: "ITA", symbol: "FTSEMIB.MI", name: "FTSE MIB" },
  { iso3: "ESP", symbol: "^IBEX", name: "IBEX 35" },
  { iso3: "NLD", symbol: "^AEX", name: "AEX" },
  { iso3: "CHE", symbol: "^SSMI", name: "SMI" },
  { iso3: "MEX", symbol: "^MXX", name: "S&P/BMV IPC" },
  { iso3: "ZAF", symbol: "^J203.JO", name: "FTSE/JSE All Share" },
  { iso3: "SAU", symbol: "^TASI.SR", name: "Tadawul All Share" },
  { iso3: "TUR", symbol: "XU100.IS", name: "BIST 100" },
  { iso3: "ISR", symbol: "TA35.TA", name: "TA-35" },
  { iso3: "SGP", symbol: "^STI", name: "Straits Times" },
  { iso3: "TWN", symbol: "^TWII", name: "TAIEX" },
  { iso3: "IDN", symbol: "^JKSE", name: "IDX Composite" },
  { iso3: "THA", symbol: "^SET.BK", name: "SET" },
  { iso3: "NZL", symbol: "^NZ50", name: "S&P/NZX 50" },
  { iso3: "SWE", symbol: "^OMXS30", name: "OMX Stockholm 30" },
  { iso3: "DNK", symbol: "^OMXC25", name: "OMX Copenhagen 25" },
  { iso3: "BEL", symbol: "^BFX", name: "BEL 20" },
  { iso3: "AUT", symbol: "^ATX", name: "ATX" },
  { iso3: "PRT", symbol: "PSI20.LS", name: "PSI" },
  { iso3: "POL", symbol: "WIG20.WA", name: "WIG20" },
  { iso3: "HUN", symbol: "^BUX.BD", name: "BUX" },
  { iso3: "ARG", symbol: "^MERV", name: "MERVAL" },
  { iso3: "MYS", symbol: "^KLSE", name: "FTSE Bursa Malaysia KLCI" },
  { iso3: "EGY", symbol: "^CASE30", name: "EGX 30" },
  { iso3: "VNM", symbol: "^VNINDEX.VN", name: "VN-Index" },
];

interface YahooChart {
  chart?: {
    result?: Array<{
      meta?: { currency?: string; exchangeName?: string; longName?: string; shortName?: string; gmtoffset?: number; regularMarketTime?: number; regularMarketPrice?: number };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }> | null;
    error?: { description?: string } | null;
  };
}

/** Un indice : dernier cours et variation entre les deux dernières séances ; null si les données manquent. */
export function parseYahooIndex(raw: unknown, def: { iso3: string; symbol: string; name: string }, ctx: FeedContext): LiveItem | null {
  const result = (raw as YahooChart | null)?.chart?.result?.[0];
  const closes = result?.indicators?.quote?.[0]?.close;
  const stamps = result?.timestamp;
  if (!result || !closes || !stamps) return null;
  const points: Array<{ t: number; close: number }> = [];
  stamps.forEach((t, i) => {
    const close = closes[i];
    if (typeof close === "number" && Number.isFinite(close)) points.push({ t, close });
  });
  const last = points.at(-1);
  if (!last) return null;
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const offset = result.meta?.gmtoffset ?? 0;
  // Date de séance dans le fuseau de la place boursière.
  const sessionDate = new Date((last.t + offset) * 1000).toISOString().slice(0, 10);
  const pct = prev && prev.close !== 0 ? ((last.close - prev.close) / prev.close) * 100 : null;
  const price = Math.round(last.close * 100) / 100;
  const currency = result.meta?.currency;
  return {
    id: `yahoo-indices:${def.symbol}:${sessionDate}`,
    category: "economy",
    nature: "market_quote",
    title: `${def.name} : ${price.toLocaleString("fr-FR")}${pct !== null ? ` (${trend(pct)})` : ""}`,
    summary: `Dernier cours ${price.toLocaleString("fr-FR")}${currency ? ` ${currency}` : ""}, séance du ${sessionDate}${pct !== null && prev ? `, contre ${(Math.round(prev.close * 100) / 100).toLocaleString("fr-FR")} à la séance précédente` : ""}.`,
    url: `https://finance.yahoo.com/quote/${encodeURIComponent(def.symbol)}`,
    sourceId: "yahoo-indices",
    sourceName: "Yahoo Finance (indices boursiers)",
    publishedAt: toIso(last.t * 1000),
    occurredAt: toIso(last.t * 1000),
    fetchedAt: ctx.fetchedAt,
    countries: [def.iso3],
    lat: null,
    lon: null,
    severity: pct !== null ? moveSeverity(pct) : null,
    metric: pct !== null ? { label: "Variation vs séance précédente", value: Number(pct.toFixed(3)), unit: "%" } : null,
    caveat: "Cotation via Yahoo Finance (source non officielle, différée).",
  };
}

export const economySources: FeedSourceDef[] = [
  {
    sourceId: "ecb-fx",
    sourceName: "BCE via Frankfurter",
    category: "economy",
    homepage: "https://frankfurter.dev",
    license: "Taux de référence BCE, usage libre avec mention de la source",
    ttlMs: 30 * 60_000,
    async load(ctx) {
      const from = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
      return parseFrankfurter(await fetchJson(`https://api.frankfurter.dev/v1/${from}..?base=EUR`), ctx);
    },
  },
  {
    sourceId: "yahoo-indices",
    sourceName: "Yahoo Finance (indices boursiers)",
    category: "economy",
    homepage: "https://finance.yahoo.com",
    license: "Non officiel : cotations différées Yahoo Finance, usage informatif",
    ttlMs: 15 * 60_000,
    async load(ctx) {
      let hardFailure: unknown = null;
      // Concurrence limitée à 4 et requêtes espacées pour ménager le service.
      const results = await mapLimit(STOCK_INDICES, 4, async (def, i) => {
        await sleep((i % 4) * 150);
        try {
          const raw = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(def.symbol)}?range=5d&interval=1d`);
          return parseYahooIndex(raw, def, ctx);
        } catch (error) {
          hardFailure = error;
          return null;
        }
      });
      const items = results.filter((r): r is LiveItem => r !== null);
      if (!items.length) throw hardFailure instanceof FeedError ? hardFailure : new FeedError("Yahoo Finance n'a renvoyé aucune cotation exploitable.");
      return items;
    },
  },
];

