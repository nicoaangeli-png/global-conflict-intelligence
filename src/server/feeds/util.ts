import type { FeedCategory, FeedSourceState, LiveItem } from "@/types/feeds";
import { ingestFeedSignals } from "@/server/detection";
import { countryAt, type WorldIndex } from "@/lib/geo/world";
import { readResponseBytes, ResponseTooLargeError } from "@/server/connectors/types";
import { getSourceHealth, markUnconfigured, newestDate, recordAttempt, type SourceDescriptor } from "@/server/health/registry";

export const USER_AGENT = "ORBITAL/0.2 (planetary monitor; contact nicoa.angeli@gmail.com)";
export const FETCH_TIMEOUT_MS = 10_000;
/** Plafond par défaut des flux texte/JSON : 5 Mio après décodage HTTP. */
export const DEFAULT_FEED_MAX_BYTES = 5 * 1024 * 1024;

/** Erreur dont le message est destiné à l'utilisateur (aucun détail technique sensible). */
export class FeedError extends Error {}

export interface FetchOptions {
  accept?: string;
  timeoutMs?: number;
  /** Limite de taille de réponse (octets) pour éviter de charger un fichier inattendu. */
  maxBytes?: number;
}

/** GET avec délai maximal et User-Agent ORBITAL. Retourne les octets bruts. */
export async function fetchBytes(url: string, options: FetchOptions = {}): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: options.accept ?? "*/*" },
    });
    if (!response.ok) {
      const host = new URL(url).host;
      if (response.status === 429) throw new FeedError(`${host} limite le nombre de requêtes (HTTP 429) ; nouvelle tentative plus tard.`);
      if (response.status === 403) throw new FeedError(`${host} refuse l'accès automatisé (HTTP 403) ; aucun contournement n'est tenté.`);
      throw new FeedError(`${host} a répondu HTTP ${response.status}.`);
    }
    return await readResponseBytes(response, options.maxBytes ?? DEFAULT_FEED_MAX_BYTES, controller);
  } catch (error) {
    if (error instanceof FeedError) throw error;
    if (error instanceof ResponseTooLargeError) {
      throw new FeedError(`Réponse plus volumineuse que prévu (limite ${error.maxBytes} octets) ; téléchargement interrompu.`);
    }
    if (error instanceof Error && error.name === "AbortError") throw new FeedError(`${new URL(url).host} n'a pas répondu en ${(options.timeoutMs ?? FETCH_TIMEOUT_MS) / 1000} s.`);
    throw new FeedError(`${new URL(url).host} est injoignable.`);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  return new TextDecoder("utf-8").decode(await fetchBytes(url, options)).replace(/^﻿/, "");
}

export async function fetchJson<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
  const text = await fetchText(url, { accept: "application/json", ...options });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new FeedError(`${new URL(url).host} a renvoyé une réponse illisible (JSON attendu).`);
  }
}

// ---------------------------------------------------------------------------
// Texte : entités HTML, balises, XML/RSS
// ---------------------------------------------------------------------------

// Entités nommées HTML : jeu Latin-1 complet (codes 160 à 255, dans l'ordre de la spécification) + ponctuation courante.
const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest " +
  "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig " +
  "agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml";
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", euro: "€", bull: "•", trade: "™",
  OElig: "Œ", oelig: "œ", Scaron: "Š", scaron: "š",
};
LATIN1.split(" ").forEach((name, i) => {
  NAMED_ENTITIES[name] = String.fromCharCode(160 + i);
});
NAMED_ENTITIES.nbsp = " ";

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/** Texte brut : retire balises (et scripts/styles), décode les entités, compacte les espaces. */
export function plainText(value: string | null | undefined): string {
  if (!value) return "";
  let text = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/li>/gi, " ").replace(/<[^>]*>/g, " ");
  // Deux passes : certaines sources encodent deux fois (&amp;nbsp;), puis le HTML décodé est de nouveau nettoyé.
  text = decodeEntities(decodeEntities(text)).replace(/<[^>]*>/g, " ");
  return text.replace(/[ \s]+/g, " ").trim();
}

/** Coupe proprement à `max` caractères (sur une limite de mot) avec « … ». */
export function clip(text: string, max = 400): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

export function summaryOrNull(value: string | null | undefined, max = 400): string | null {
  const text = plainText(value);
  return text ? clip(text, max) : null;
}

/** Valeur (décodée) de la première balise `<tag>` d'un bloc XML, CDATA géré. */
export function xmlTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const match = re.exec(block);
  if (!match) return null;
  const inner = match[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner);
  return cdata ? cdata[1].trim() : decodeEntities(inner).trim();
}

/** Blocs `<item>…</item>` d'un flux RSS. */
export function rssItems(xml: string): string[] {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
}

/** Date RSS/ISO → ISO 8601 UTC, ou null si illisible. */
export function toIso(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  // Date ISO sans fuseau (ex. GDACS « 2026-10-13T15:00:00 ») : interprétée en UTC.
  const text = typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value) ? `${value}Z` : value;
  const time = new Date(text).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

// ---------------------------------------------------------------------------
// Pays à partir de coordonnées
// ---------------------------------------------------------------------------

export function countryFromCoords(index: WorldIndex | null, lat: number | null, lon: number | null): string[] {
  if (!index || lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const country = countryAt(index, lat, lon);
  return country?.iso && /^[A-Z]{3}$/.test(country.iso) ? [country.iso] : [];
}

export function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// ---------------------------------------------------------------------------
// Définition d'une source et exécution avec cache mémoire
// ---------------------------------------------------------------------------

export interface FeedContext {
  fetchedAt: string;
  index: WorldIndex | null;
}

export interface FeedSourceDef {
  sourceId: string;
  sourceName: string;
  category: FeedCategory;
  homepage: string;
  license: string | null;
  /** Durée de validité du cache en cas de succès. */
  ttlMs: number;
  /** Durée avant nouvelle tentative après un échec (protège les quotas, ex. Launch Library 2). */
  errorTtlMs?: number;
  /** Retourne les éléments (avec avertissement de succès éventuel), ou lève une FeedError. */
  load(ctx: FeedContext): Promise<LiveItem[] | FeedLoadResult>;
  /** Source sans flux exploitable : état affiché tel quel, sans appel réseau. */
  unavailable?: { status: "error" | "not_configured"; message: string };
  /** Limite ou quota connu de la source, en clair (santé des sources). */
  quota?: string;
}

export interface FeedLoadResult {
  items: LiveItem[];
  /** Avertissement lisible malgré un statut `ok` (ex. source partiellement disponible). */
  message: string | null;
}

interface CacheEntry {
  at: number; // dernier essai
  okAt: number | null; // dernier succès
  items: LiveItem[];
  state: FeedSourceState;
  inflight?: Promise<void>;
}

type Store = Map<string, CacheEntry>;
const GLOBAL_KEY = "__orbitalFeedsCache";

function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  return (g[GLOBAL_KEY] ??= new Map());
}

export function clearFeedsCache(): void {
  store().clear();
}

function baseState(def: FeedSourceDef): Omit<FeedSourceState, "status" | "message" | "fetchedAt" | "itemCount"> {
  return { sourceId: def.sourceId, sourceName: def.sourceName, category: def.category, homepage: def.homepage, license: def.license };
}

/** Descripteur de santé d'une source de flux (registre commun). */
export function feedDescriptor(def: FeedSourceDef): SourceDescriptor {
  return {
    id: `feed:${def.sourceId}`,
    kind: "feed",
    name: def.sourceName,
    category: def.category,
    homepage: def.homepage,
    license: def.license,
    quota: def.quota ?? null,
    // Au-delà de 3 périodes de rafraîchissement sans succès, les données sont anciennes.
    staleAfterMs: def.ttlMs * 3,
  };
}

/** État publié enrichi de la santé normalisée (copie : l'état en cache n'est pas modifié). */
function withHealth(def: FeedSourceDef, state: FeedSourceState, nowMs: number): FeedSourceState {
  const health = getSourceHealth(`feed:${def.sourceId}`, nowMs);
  if (!health) return state;
  return { ...state, health: health.status, lastSuccessAt: health.lastSuccessAt, latencyMs: health.latencyMs, newestDataAt: health.newestDataAt, quota: health.quota };
}

const itemDate = (item: LiveItem) => item.occurredAt ?? item.publishedAt;

function readableError(error: unknown): string {
  if (error instanceof FeedError) return error.message;
  return "Données reçues dans un format inattendu ; source ignorée.";
}

/**
 * Exécute une source avec cache : jamais d'exception. En cas d'échec, les derniers éléments valides
 * sont conservés (état « stale ») ; sans élément antérieur, l'état est « error » avec un message lisible.
 */
export async function runSource(
  def: FeedSourceDef,
  getIndex: () => Promise<WorldIndex | null>,
  now: () => number = Date.now,
): Promise<{ items: LiveItem[]; state: FeedSourceState }> {
  const descriptor = feedDescriptor(def);
  if (def.unavailable) {
    if (def.unavailable.status === "not_configured") markUnconfigured(descriptor, def.unavailable.message);
    else if (!getSourceHealth(descriptor.id)?.lastAttemptAt) recordAttempt(descriptor, { ok: false, startedAt: now(), finishedAt: now(), error: def.unavailable.message });
    const state: FeedSourceState = { ...baseState(def), status: def.unavailable.status, message: def.unavailable.message, fetchedAt: null, itemCount: 0 };
    return { items: [], state: withHealth(def, state, now()) };
  }
  const cache = store();
  let entry = cache.get(def.sourceId);
  const fresh = (e: CacheEntry) => now() - e.at < (e.okAt === e.at ? def.ttlMs : (def.errorTtlMs ?? Math.min(def.ttlMs, 120_000)));
  if (entry && (fresh(entry) || entry.inflight)) {
    if (entry.inflight) await entry.inflight;
    entry = cache.get(def.sourceId) ?? entry;
    return { items: entry.items, state: withHealth(def, entry.state, now()) };
  }

  const previous = entry;
  const next: CacheEntry = previous ?? {
    at: 0,
    okAt: null,
    items: [],
    state: { ...baseState(def), status: "error", message: null, fetchedAt: null, itemCount: 0 },
  };
  cache.set(def.sourceId, next);
  next.inflight = (async () => {
    const started = now();
    try {
      const index = await getIndex().catch(() => null);
      const fetchedAt = new Date(started).toISOString();
      const loaded = await def.load({ fetchedAt, index });
      const items = Array.isArray(loaded) ? loaded : loaded.items;
      const message = Array.isArray(loaded) ? null : loaded.message;
      next.items = items;
      next.at = now();
      next.okAt = next.at;
      next.state = { ...baseState(def), status: "ok", message, fetchedAt, itemCount: items.length };
      await ingestFeedSignals(items);
      recordAttempt(descriptor, { ok: true, startedAt: started, finishedAt: next.at, itemCount: items.length, newestDataAt: newestDate(items.map(itemDate), next.at), warning: message });
    } catch (error) {
      next.at = now();
      const message = readableError(error);
      recordAttempt(descriptor, { ok: false, startedAt: started, finishedAt: next.at, error: message, servedItems: next.okAt !== null ? next.items.length : 0 });
      if (next.items.length && next.okAt !== null) {
        next.state = {
          ...next.state,
          status: "stale",
          message: `Dernière mise à jour impossible : ${message} Affichage des dernières données valides.`,
          itemCount: next.items.length,
        };
      } else {
        next.items = [];
        next.state = { ...baseState(def), status: "error", message, fetchedAt: null, itemCount: 0 };
      }
    } finally {
      next.inflight = undefined;
    }
  })();
  await next.inflight;
  return { items: next.items, state: withHealth(def, next.state, now()) };
}

/** Exécute `worker` sur `values` avec au plus `limit` appels simultanés. */
export async function mapLimit<T, R>(values: T[], limit: number, worker: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const at = cursor++;
      results[at] = await worker(values[at], at);
    }
  });
  await Promise.all(runners);
  return results;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RssEntry {
  title: string;
  link: string | null;
  guid: string | null;
  description: string;
  pubDate: string | null;
}

/** Entrées d'un flux RSS 2.0 (texte brut, dates ISO). Les éléments sans titre sont ignorés. */
export function parseRss(xml: string): RssEntry[] {
  if (!/<rss[\s>]|<channel[\s>]/i.test(xml)) throw new FeedError("Le flux reçu n'est pas un RSS valide.");
  const entries: RssEntry[] = [];
  for (const block of rssItems(xml)) {
    const title = plainText(xmlTag(block, "title"));
    if (!title) continue;
    entries.push({
      title,
      link: str(xmlTag(block, "link")),
      guid: str(xmlTag(block, "guid")),
      description: xmlTag(block, "description") ?? "",
      pubDate: toIso(xmlTag(block, "pubDate")),
    });
  }
  return entries;
}
