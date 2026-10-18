import { createHash } from "node:crypto";
import { inflateRaw } from "node:zlib";
import { promisify } from "node:util";
import type { ConflictEvent, EventType, GeoPrecision } from "@/types/conflict";
import type { LiveItem } from "@/types/feeds";
import { resolveCountryIdentity, fipsToIso3 } from "@/lib/geo/country";
import { ConnectorError, type Connector, safeFetch, providerDate, validCoordinates } from "./types";

/**
 * Connecteur GDELT 2.0 « Events » (remplace le flux GKG v1 de `gdelt.ts`).
 *
 * GDELT publie toutes les 15 minutes trois fichiers zip :
 *   <ts>.export.CSV.zip  événements CAMEO (61 colonnes, sans titre),
 *   <ts>.gkg.csv.zip     graphe de connaissances (27 colonnes) — on y lit le titre,
 *   <ts>.mentions.CSV.zip (non utilisé).
 * `lastupdate.txt` donne le dernier jeu publié. Au premier passage on rattrape
 * les N derniers fichiers (96 = 24 h), du plus récent au plus ancien, avec un
 * budget de temps par passage : la suite est rattrapée aux passages suivants.
 *
 * Nature des données : signal PRESSE (provenance media_monitoring, confiance
 * MEDIA_SIGNAL). Le codage CAMEO est automatique et bruité (un article de
 * cuisine peut être codé « manifestation ») : jamais un fait confirmé, jamais
 * de bilan humain (`fatalities` = 0 = non applicable pour ce jeu de données).
 *
 * ── Colonnes de l'export 2.0 utilisées (index base 0, 61 colonnes) ──────────
 *    0 GLOBALEVENTID      1 SQLDATE (jour déclaré, non utilisé : peu fiable)
 *   26 EventCode (CAMEO)  28 EventRootCode   29 QuadClass   30 GoldsteinScale
 *   31 NumMentions        32 NumSources      33 NumArticles
 *   51 ActionGeo_Type (1 pays, 2 État US, 3 ville US, 4 ville monde, 5 région monde)
 *   52 ActionGeo_FullName 53 ActionGeo_CountryCode (FIPS 10-4 !)
 *   56 ActionGeo_Lat      57 ActionGeo_Long
 *   59 DATEADDED (AAAAMMJJHHMMSS, UTC : instant où GDELT a vu l'article)
 *   60 SOURCEURL
 * ── Colonnes GKG 2.1 utilisées (27 colonnes) ────────────────────────────────
 *    4 DocumentIdentifier (= SOURCEURL)   26 Extras (contient <PAGE_TITLE>…</PAGE_TITLE>)
 */

export const EVENT_COL = {
  id: 0, code: 26, root: 28, quad: 29, goldstein: 30, mentions: 31, sources: 32, articles: 33,
  geoType: 51, geoName: 52, geoCountry: 53, lat: 56, lon: 57, dateAdded: 59, url: 60,
} as const;
export const EVENT_COLUMNS = 61;
export const GKG_COL = { docId: 4, extras: 26 } as const;
export const GKG_COLUMNS = 27;

const BASE_URL = "https://data.gdeltproject.org/gdeltv2";
const STEP_MS = 15 * 60 * 1000;
const MAX_UNZIPPED = 200 * 1024 * 1024;

/** Fichiers 15 min rattrapés (défaut 96 = 24 h), paramétrable par GDELT_EVENTS_CATCHUP_FILES. */
const catchupFiles = () => clampInt(process.env.GDELT_EVENTS_CATCHUP_FILES, 96, 1, 672);
/** Budget de temps d'un passage (ms) ; le reste est rattrapé au passage suivant. */
const passBudgetMs = () => clampInt(process.env.GDELT_EVENTS_BUDGET_MS, 100_000, 5_000, 600_000);
const POLITE_DELAY_MS = 250;

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * Filtre qualité d'une ligne : au moins 2 sources distinctes OU au moins 3
 * articles. Une ligne vue par un seul article d'un seul média est surtout du
 * bruit de codage automatique ; deux sources indépendantes (ou un article repris
 * trois fois) rendent un faux positif moins probable sans le supprimer.
 */
export const MIN_SOURCES = 2;
export const MIN_ARTICLES = 3;

// ─── Mapping CAMEO ──────────────────────────────────────────────────────────

const ROOTS = new Set(["14", "18", "19", "20"]);

export interface CameoInfo {
  eventType: EventType;
  subEventType: string;
  /** Famille « troubles sociaux » (racine 14) : alimente le flux social. */
  social: boolean;
}

/** CAMEO EventCode (2 à 4 chiffres) → type d'événement ORBITAL, ou null si ignoré. */
export function mapCameo(code: string): CameoInfo | null {
  const c = code.trim();
  if (!/^\d{2,4}$/.test(c)) return null;
  const root = c.slice(0, 2);
  if (!ROOTS.has(root)) return null;
  const base = c.slice(0, 3);
  if (root === "14") {
    const sub: Record<string, string> = {
      "141": "Manifestation", "142": "Grève de la faim", "143": "Grève / boycott",
      "144": "Blocage", "145": "Émeute / manifestation violente",
    };
    const social = true;
    if (base === "145") return { eventType: "Riots", subEventType: sub["145"], social };
    return { eventType: "Protests", subEventType: sub[base] ?? "Manifestation", social };
  }
  if (root === "18") {
    if (base === "183") return { eventType: "Explosions/Remote violence", subEventType: "Attentat à l'explosif", social: false };
    const sub: Record<string, string> = { "181": "Enlèvement", "182": "Agression", "184": "Bouclier humain", "185": "Assassinat", "186": "Assassinat" };
    return { eventType: "Violence against civilians", subEventType: sub[base] ?? "Agression", social: false };
  }
  if (root === "19") {
    if (base === "194" || base === "195") return { eventType: "Explosions/Remote violence", subEventType: base === "195" ? "Armes aériennes" : "Artillerie / blindés", social: false };
    if (base === "191" || base === "192" || base === "196") {
      return { eventType: "Strategic developments", subEventType: base === "191" ? "Blocus" : base === "192" ? "Occupation de territoire" : "Violation de cessez-le-feu", social: false };
    }
    return { eventType: "Battles", subEventType: base === "193" ? "Combat armes légères" : "Usage de la force conventionnelle", social: false };
  }
  // 20x violence de masse
  if (base === "201") return { eventType: "Strategic developments", subEventType: "Expulsion de masse", social: false };
  if (base === "204") return { eventType: "Explosions/Remote violence", subEventType: "Armes de destruction massive", social: false };
  return { eventType: "Violence against civilians", subEventType: base === "203" ? "Nettoyage ethnique" : base === "202" ? "Massacres" : "Violence de masse", social: false };
}

/** ActionGeo_Type → précision. 3/4 villes, 2/5 région (État / subdivision), 1 pays. 0 ou autre = inutilisable. */
export function geoPrecisionOf(type: number): GeoPrecision | null {
  if (type === 3 || type === 4) return "city";
  if (type === 2 || type === 5) return "region";
  if (type === 1) return "country";
  return null;
}

// ─── Lecture du zip (sans dépendance) ───────────────────────────────────────

const inflateRawAsync = promisify(inflateRaw) as (buf: Buffer, opts: { maxOutputLength: number }) => Promise<Buffer>;

/** Contenu du premier fichier d'une archive zip (répertoire central → en-tête local → inflateRaw). */
export async function unzipFirstEntry(zip: Buffer): Promise<Buffer> {
  const bad = (m: string) => new ConnectorError(`Archive GDELT invalide (${m})`, "gdelt", "parse");
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw bad("fin de répertoire absente");
  const cd = zip.readUInt32LE(eocd + 16);
  if (cd + 46 > zip.length || zip.readUInt32LE(cd) !== 0x02014b50) throw bad("répertoire central");
  const method = zip.readUInt16LE(cd + 10);
  const compSize = zip.readUInt32LE(cd + 20);
  const local = zip.readUInt32LE(cd + 42);
  if (compSize === 0xffffffff || local === 0xffffffff) throw bad("zip64 non géré");
  if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw bad("en-tête local");
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const data = zip.subarray(start, start + compSize);
  if (data.length !== compSize) throw bad("données tronquées");
  if (method === 0) return Buffer.from(data);
  if (method !== 8) throw bad(`méthode ${method}`);
  try {
    return await inflateRawAsync(data, { maxOutputLength: MAX_UNZIPPED });
  } catch {
    throw bad("décompression");
  }
}

// ─── Horodatages ────────────────────────────────────────────────────────────

export interface LastUpdate { ts: string }

/** `lastupdate.txt` : 3 lignes « taille md5 url » ; l'horodatage vient du nom du fichier export. */
export function parseLastUpdate(text: string): LastUpdate | null {
  const m = /\/(\d{14})\.export\.CSV\.zip/i.exec(text);
  return m ? { ts: m[1] } : null;
}

export function tsToDate(ts: string): Date | null {
  const iso = providerDate(ts);
  return iso ? new Date(iso) : null;
}

export function dateToTs(d: Date): string {
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/** `count` horodatages 15 min en partant de `latest` (inclus), du plus récent au plus ancien. */
export function recentTimestamps(latest: string, count: number): string[] {
  const start = tsToDate(latest);
  if (!start) return [];
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(dateToTs(new Date(start.getTime() - i * STEP_MS)));
  return out;
}

// ─── Analyse des CSV ────────────────────────────────────────────────────────

export interface RawRow {
  code: string;
  root: string;
  mentions: number;
  sources: number;
  articles: number;
  geoType: number;
  geoName: string;
  fips: string;
  lat: number;
  lon: number;
  /** DATEADDED en ISO 8601 UTC. */
  addedAt: string;
  url: string;
}

function cleanUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

/** Lignes de l'export retenues : CAMEO 14/18/19/20, géolocalisées, filtre qualité, URL valide. */
export function parseExportCsv(text: string): { rows: RawRow[]; scanned: number } {
  const rows: RawRow[] = [];
  let scanned = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    const f = line.replace(/\r$/, "").split("\t");
    if (f.length < EVENT_COLUMNS) continue;
    scanned++;
    const code = f[EVENT_COL.code];
    if (!mapCameo(code)) continue;
    const sources = Number(f[EVENT_COL.sources]);
    const articles = Number(f[EVENT_COL.articles]);
    if (!(sources >= MIN_SOURCES || articles >= MIN_ARTICLES)) continue;
    const geoType = Number(f[EVENT_COL.geoType]);
    if (!geoPrecisionOf(geoType)) continue;
    const latRaw = f[EVENT_COL.lat];
    const lonRaw = f[EVENT_COL.lon];
    if (latRaw === "" || lonRaw === "") continue;
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!validCoordinates(lat, lon)) continue;
    const addedAt = providerDate(f[EVENT_COL.dateAdded]);
    const url = cleanUrl(f[EVENT_COL.url]);
    if (!addedAt || !url) continue;
    rows.push({
      code,
      root: f[EVENT_COL.root] || code.slice(0, 2),
      mentions: Number(f[EVENT_COL.mentions]) || 0,
      sources,
      articles,
      geoType,
      geoName: f[EVENT_COL.geoName].trim(),
      fips: f[EVENT_COL.geoCountry].trim(),
      lat,
      lon,
      addedAt,
      url,
    });
  }
  return { rows, scanned };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Titre de page d'une cellule Extras GKG, ou null. Jamais déduit de l'URL. */
export function titleFromExtras(extras: string): string | null {
  const m = /<PAGE_TITLE>([\s\S]*?)<\/PAGE_TITLE>/.exec(extras);
  if (!m) return null;
  const t = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
  return t.length >= 3 && !/^https?:\/\//i.test(t) ? t.slice(0, 240) : null;
}

/** Titres GKG (DocumentIdentifier → titre) restreints aux URL demandées. */
export function parseGkgTitles(text: string, wanted: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  if (!wanted.size) return out;
  for (const line of text.split("\n")) {
    if (!line.includes("<PAGE_TITLE>")) continue;
    const f = line.split("\t");
    if (f.length < GKG_COLUMNS) continue;
    const url = cleanUrl(f[GKG_COL.docId]);
    if (!url || !wanted.has(url)) continue;
    const title = titleFromExtras(f[GKG_COL.extras]);
    if (title) out.set(url, title);
  }
  return out;
}

// ─── Construction des événements ────────────────────────────────────────────

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "presse internationale";
  }
}

interface Merged {
  row: RawRow;
  info: CameoInfo;
  precision: GeoPrecision;
  iso3: string | null;
  firstSeen: string;
  mentions: number;
  sources: number;
  articles: number;
}

const PRECISION_RANK: Record<GeoPrecision, number> = { city: 3, region: 2, country: 1 };

/**
 * Dédoublonnage : une même URL + même code racine + même lieu = UN événement
 * (les lignes répétées, dans un fichier ou d'un fichier à l'autre, fusionnent :
 * date la plus ancienne, compteurs au maximum — pas de somme, ce serait recompter
 * le même article). Un article qui cite plusieurs lieux garde ses lieux
 * distincts ; un lieu de niveau pays/région est supprimé lorsque le même
 * article a un lieu plus précis dans le même pays (même fait, grain plus fin).
 */
function mergeRows(rows: RawRow[]): Merged[] {
  const byKey = new Map<string, Merged>();
  for (const row of rows) {
    const info = mapCameo(row.code);
    const precision = geoPrecisionOf(row.geoType);
    if (!info || !precision) continue;
    const key = `${row.url}|${row.root}|${row.fips}|${row.geoName.toLowerCase()}|${row.lat.toFixed(3)}|${row.lon.toFixed(3)}`;
    const cur = byKey.get(key);
    if (cur) {
      if (row.addedAt < cur.firstSeen) cur.firstSeen = row.addedAt;
      cur.mentions = Math.max(cur.mentions, row.mentions);
      cur.sources = Math.max(cur.sources, row.sources);
      cur.articles = Math.max(cur.articles, row.articles);
      continue;
    }
    byKey.set(key, {
      row, info, precision, iso3: fipsToIso3(row.fips), firstSeen: row.addedAt,
      mentions: row.mentions, sources: row.sources, articles: row.articles,
    });
  }
  const all = [...byKey.values()];
  const best = new Map<string, number>();
  for (const m of all) {
    const k = `${m.row.url}|${m.row.root}|${m.row.fips}`;
    best.set(k, Math.max(best.get(k) ?? 0, PRECISION_RANK[m.precision]));
  }
  return all.filter((m) => PRECISION_RANK[m.precision] >= (best.get(`${m.row.url}|${m.row.root}|${m.row.fips}`) ?? 0));
}

function placeParts(geoName: string, precision: GeoPrecision): { locality: string; region: string } {
  const parts = geoName.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { locality: "", region: "" };
  if (precision === "country" || parts.length === 1) return { locality: parts[0], region: "" };
  return { locality: parts[0], region: parts.length > 2 ? parts.slice(1, -1).join(", ") : "" };
}

function countryLabel(iso3: string | null): string {
  if (!iso3) return "";
  const id = resolveCountryIdentity(iso3);
  return id && id.name !== id.iso3 ? id.name : iso3;
}

/** Lignes retenues + titres connus → événements ORBITAL dédoublonnés. */
export function buildEvents(rows: RawRow[], titles: ReadonlyMap<string, string | null>, now: string): ConflictEvent[] {
  return mergeRows(rows).map((m) => {
    const { row, info, precision } = m;
    const title = titles.get(row.url) ?? null;
    const domain = domainOf(row.url);
    const idKey = `${row.url}|${row.root}|${row.fips}|${row.geoName.toLowerCase()}|${row.lat.toFixed(3)}|${row.lon.toFixed(3)}`;
    const { locality, region } = placeParts(row.geoName, precision);
    return {
      id: `gdelt-ev-${createHash("sha256").update(idKey).digest("hex").slice(0, 32)}`,
      latitude: row.lat,
      longitude: row.lon,
      country: countryLabel(m.iso3),
      region,
      locality,
      eventType: info.eventType,
      subEventType: info.subEventType,
      actors: [],
      // Mention presse : 0 = « non applicable », jamais « aucune victime ».
      fatalities: 0,
      source: title ? `GDELT · ${domain} · « ${title} »` : `GDELT · ${domain} (titre non fourni)`,
      sourceUrl: row.url,
      sourceDataset: "gdelt",
      confidence: "MEDIA_SIGNAL",
      // DATEADDED : instant où GDELT a vu l'article (UTC), distinct de la collecte.
      eventDate: m.firstSeen,
      updatedAt: now,
      title,
      geoPrecision: precision,
    };
  });
}

// ─── Cache et collecte ──────────────────────────────────────────────────────

interface FileEntry { rows: RawRow[] | null; at: number }
interface GdeltEventsState {
  files: Map<string, FileEntry>;
  titles: Map<string, string | null>;
  latestTs: string | null;
  inflight: Promise<void> | null;
  lastCheckAt: number;
  report: string | null;
}

const ref = globalThis as unknown as { __orbitalGdeltEvents?: GdeltEventsState };
const cache: GdeltEventsState = (ref.__orbitalGdeltEvents ??= {
  files: new Map(), titles: new Map(), latestTs: null, inflight: null, lastCheckAt: 0, report: null,
});
const MAX_TITLES = 30_000;
const MIN_CHECK_MS = 2 * 60 * 1000;

/** Vide le cache (tests). */
export function resetGdeltEventsCache(): void {
  cache.files.clear(); cache.titles.clear(); cache.latestTs = null; cache.inflight = null; cache.lastCheckAt = 0; cache.report = null;
}

export interface GdeltFetchers {
  /** Renvoie le texte, ou null pour un 404 (fichier non publié). */
  text(url: string): Promise<string | null>;
  bytes(url: string): Promise<Buffer | null>;
}

async function httpBytes(url: string, timeout: number): Promise<Buffer | null> {
  try {
    const res = await safeFetch("gdelt", url, {}, timeout);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof ConnectorError && /HTTP 404/.test(err.message)) return null;
    throw err;
  }
}

const defaultFetchers: GdeltFetchers = {
  async text(url) {
    const b = await httpBytes(url, 15_000);
    return b ? b.toString("utf8") : null;
  },
  bytes: (url) => httpBytes(url, 45_000),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Un passage de collecte : lit `lastupdate.txt`, puis télécharge séquentiellement
 * (poliment) les fichiers 15 min absents du cache, du plus récent au plus ancien,
 * dans la limite du budget. Les fichiers déjà traités ne sont jamais retéléchargés.
 */
export async function refreshGdeltEvents(opts: { files?: number; budgetMs?: number; fetchers?: GdeltFetchers; delayMs?: number; force?: boolean } = {}): Promise<void> {
  if (cache.inflight) return cache.inflight;
  const run = (async () => {
    const f = opts.fetchers ?? defaultFetchers;
    const wanted = opts.files ?? catchupFiles();
    const deadline = Date.now() + (opts.budgetMs ?? passBudgetMs());
    const delay = opts.delayMs ?? POLITE_DELAY_MS;

    if (opts.force || Date.now() - cache.lastCheckAt >= MIN_CHECK_MS || !cache.latestTs) {
      const text = await f.text(`${BASE_URL}/lastupdate.txt`);
      const last = text ? parseLastUpdate(text) : null;
      if (!last) {
        if (!cache.files.size) throw new ConnectorError("lastupdate.txt GDELT illisible", "gdelt", "parse");
      } else {
        cache.latestTs = last.ts;
        cache.lastCheckAt = Date.now();
      }
    }
    if (!cache.latestTs) throw new ConnectorError("Aucun fichier GDELT disponible", "gdelt", "network");

    const wantedTs = recentTimestamps(cache.latestTs, wanted);
    // Purge des fichiers sortis de la fenêtre.
    const keep = new Set(wantedTs);
    for (const ts of [...cache.files.keys()]) if (!keep.has(ts)) cache.files.delete(ts);

    let fetched = 0, failed = 0, titled = 0, skippedBudget = 0;
    for (const ts of wantedTs) {
      const known = cache.files.get(ts);
      // Un fichier absent (404) ou en erreur n'est retenté que s'il est récent et pas essayé depuis 5 min.
      const retry = known && known.rows === null && Date.now() - known.at > 5 * 60_000 && Date.now() - (tsToDate(ts)?.getTime() ?? 0) < 3 * 3600e3;
      if (known && !retry) continue;
      if (Date.now() > deadline) { skippedBudget++; continue; }
      if (fetched + failed > 0) await sleep(delay);
      try {
        const zip = await f.bytes(`${BASE_URL}/${ts}.export.CSV.zip`);
        if (!zip) { cache.files.set(ts, { rows: null, at: Date.now() }); continue; }
        const csv = (await unzipFirstEntry(zip)).toString("utf8");
        const { rows } = parseExportCsv(csv);
        cache.files.set(ts, { rows, at: Date.now() });
        fetched++;
        const need = new Set(rows.map((r) => r.url).filter((u) => !cache.titles.get(u)));
        if (need.size) {
          try {
            await sleep(delay);
            const gz = await f.bytes(`${BASE_URL}/${ts}.gkg.csv.zip`);
            if (gz) {
              const found = parseGkgTitles((await unzipFirstEntry(gz)).toString("utf8"), need);
              for (const [u, t] of found) { cache.titles.set(u, t); titled++; }
            }
          } catch {
            // Titres indisponibles pour ce fichier : title = null, rien d'inventé.
          }
        }
      } catch {
        failed++;
      }
    }
    if (cache.titles.size > MAX_TITLES) {
      // Les titres sont ré-obtenables ; on retire les plus anciens (ordre d'insertion).
      for (const k of [...cache.titles.keys()].slice(0, cache.titles.size - MAX_TITLES)) cache.titles.delete(k);
    }
    const done = [...cache.files.values()].filter((e) => e.rows).length;
    cache.report = `${done}/${wantedTs.length} fichiers 15 min en cache, ${fetched} téléchargés, ${titled} titres${failed ? `, ${failed} en erreur` : ""}${skippedBudget ? `, ${skippedBudget} restants (budget)` : ""}`;
    if (failed && !fetched && !done) throw new ConnectorError("Fichiers GDELT inaccessibles", "gdelt", "network");
  })();
  cache.inflight = run;
  try {
    await run;
  } finally {
    cache.inflight = null;
  }
}

/** Événements du cache, dédoublonnés, sur la fenêtre demandée (ms avant maintenant). */
export function cachedEvents(windowMs: number, nowMs = Date.now()): ConflictEvent[] {
  const rows: RawRow[] = [];
  for (const e of cache.files.values()) if (e.rows) rows.push(...e.rows);
  const from = nowMs - windowMs;
  const inWindow = rows.filter((r) => Date.parse(r.addedAt) >= from && Date.parse(r.addedAt) <= nowMs + 60_000);
  return buildEvents(inWindow, cache.titles, new Date(nowMs).toISOString());
}

export const gdeltEventsConnector: Connector = {
  id: "gdelt",
  label: "GDELT 2.0 Events",

  isConfigured() {
    return process.env.GDELT_DISABLED !== "1";
  },

  describe() {
    return "Presse mondiale GDELT 2.0 (événements CAMEO) — manifestations, émeutes, grèves et violences signalées par la presse ; signal non confirmé, sans bilan humain.";
  },

  lastReport() {
    return cache.report;
  },

  async fetchEvents({ days }) {
    if (!this.isConfigured()) throw new ConnectorError("GDELT désactivé", "gdelt", "config");
    await refreshGdeltEvents();
    const windowMs = Math.min(days * 86400e3, catchupFiles() * STEP_MS);
    return cachedEvents(windowMs);
  },
};

// ─── Flux « social » pour /api/feeds ────────────────────────────────────────

const SOCIAL_WINDOW_MS = 24 * 3600e3;
const SOCIAL_BUDGET_MS = 25_000;

/**
 * Manifestations, émeutes et grèves des dernières 24 h (racine CAMEO 14),
 * un élément par article (URL) : l'article qui cite plusieurs lieux n'est pas
 * répété, il porte tous les pays cités et le lieu le plus précis.
 */
export async function fetchSocialFeed(): Promise<LiveItem[]> {
  await refreshGdeltEvents({ budgetMs: SOCIAL_BUDGET_MS });
  const now = Date.now();
  const fetchedAt = new Date(now).toISOString();
  const events = cachedEvents(SOCIAL_WINDOW_MS, now).filter((e) => e.eventType === "Protests" || e.eventType === "Riots");

  const byUrl = new Map<string, ConflictEvent[]>();
  for (const e of events) byUrl.set(e.sourceUrl, [...(byUrl.get(e.sourceUrl) ?? []), e]);

  const items: LiveItem[] = [];
  for (const [url, group] of byUrl) {
    // Lieu principal : le plus précis, puis la violence (émeute) prime.
    const rank = (e: ConflictEvent) => PRECISION_RANK[e.geoPrecision ?? "city"] * 10 + (e.eventType === "Riots" ? 1 : 0);
    const main = [...group].sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id))[0];
    const riot = group.some((e) => e.eventType === "Riots");
    const countries = [...new Set(group.map((e) => fipsToIso3Of(e)).filter((c): c is string => !!c))];
    const first = group.map((e) => e.eventDate).sort()[0];
    const precise = main.geoPrecision === "city";
    const domain = domainOf(url);
    const place = [main.locality, main.country].filter(Boolean).join(", ");
    items.push({
      id: `gdelt-events:${createHash("sha256").update(url).digest("hex").slice(0, 24)}`,
      category: "social",
      nature: "press_article",
      // Titre réel (GKG) ; à défaut le domaine du média, jamais un titre fabriqué.
      title: main.title ?? domain,
      summary: `${riot ? "Émeute / manifestation violente" : main.subEventType}${place ? ` — ${place}` : ""}${main.title ? ` (${domain})` : " (titre non fourni)"}`,
      url,
      sourceId: "gdelt-events",
      sourceName: "GDELT 2.0 (presse mondiale)",
      publishedAt: first,
      occurredAt: first,
      fetchedAt,
      countries,
      // Un lieu de niveau pays/région n'est pas un point précis : pas de coordonnées.
      lat: precise ? main.latitude : null,
      lon: precise ? main.longitude : null,
      severity: null,
      metric: null,
      caveat: "Signal presse GDELT, non confirmé",
    });
  }
  return items.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}

/** ISO3 d'un événement construit par ce module (le champ `country` peut être un nom). */
function fipsToIso3Of(e: ConflictEvent): string | null {
  return e.country ? resolveCountryIdentity(e.country)?.iso3 ?? null : null;
}
