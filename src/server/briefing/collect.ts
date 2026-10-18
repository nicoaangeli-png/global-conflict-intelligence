import type { ConflictEvent } from "@/types/conflict";
import type { FeedCategory, FeedsResponse, LiveItem } from "@/types/feeds";
import { clusterStories, domainOf, hasRealTitle, stripOutlet, type StoryCandidate } from "./stories";
import { CHAPTER_KEYS, type BriefingFact, type ChapterKey, type FactSeverity, type FactSource } from "./types";

export { domainOf };

/** Fenêtre de base et bornage. */
export const WINDOW_MS = 24 * 3600e3;
export const MAX_FACTS_PER_CHAPTER = 8;
const MAX_SOURCES_PER_FACT = 4;
const MAX_HEADLINES = 3;

/**
 * Fenêtres successives par chapitre : 24 h d'abord ; si le chapitre est vide, on élargit
 * (la phrase devra alors dater explicitement le fait).
 */
export const WINDOWS_HOURS: Record<ChapterKey, number[]> = {
  conflicts: [24],
  politics: [24, 72],
  disasters: [24],
  economy: [24, 72], // week-end : dernière séance de bourse / dernier fixing
  space: [24],
  nuclear: [24, 72],
  society: [24],
  health: [24, 168],
};

/** Variation minimale d'une devise ou d'un indice pour entrer dans le bilan. */
export const MARKET_MIN_MOVE_PCT = 1.5;

/** Sources officielles reconnues (identifiants `sourceId` des flux). `ll2` = calendrier des lancements (agences spatiales). */
export const OFFICIAL_SOURCE_IDS = new Set(["gdacs", "usgs", "eonet", "who-don", "un-news", "un-press", "ecb-fx", "ll2"]);
const OFFICIAL_NATURES = new Set(["official_alert", "sensor_measurement", "official_publication", "scheduled_event", "market_quote"]);
/** Mesures de marché non officielles, admises comme mesure mais toujours nommées comme telles. */
const UNOFFICIAL_MEASURES: Record<string, string> = { "yahoo-indices": "Yahoo Finance" };

/** Publication ONU dont le titre concerne le nucléaire -> chapitre « nucléaire » plutôt que « politique ». */
export const NUCLEAR_TITLE = /\b(?:aiea|iaea|nucl[eé]aires?|nuclear|uranium|enrichissement|enrichment|plutonium|atomiques?|atomic|radioactiv\w*|zaporij\w*|zaporizh\w*|tnp|npt)\b/i;

const CATEGORY_TO_CHAPTER: Partial<Record<FeedCategory, ChapterKey>> = {
  disaster: "disasters",
  health: "health",
  space: "space",
  nuclear: "nuclear",
  un: "politics",
  social: "society",
  economy: "economy",
};

const SEVERITY_RANK: Record<FactSeverity, number> = { info: 0, minor: 1, moderate: 2, severe: 3, extreme: 4 };
const rank = (s: FactSeverity | null) => (s ? SEVERITY_RANK[s] : -1);

export interface CollectDeps {
  getFeeds: () => Promise<FeedsResponse>;
  /** Événements de conflit des dernières 24 h (UCDP/ACLED/GDELT). */
  getConflictEvents: () => Promise<ConflictEvent[]>;
  now?: () => number;
}

export interface Collected {
  facts: Record<ChapterKey, BriefingFact[]>;
  /** Fenêtre réellement examinée par chapitre (heures). */
  windowHours: Record<ChapterKey, number>;
  /** Raisons de dégradation de la collecte (source indisponible…). */
  notes: string[];
}

export const CASUALTY_WORDS = /\b(?:morts?|tu[ée]s?|bless[ée]s?|victimes?|d[ée]c[èe]s|disparus|killed|dead|deaths?|injured|casualties)\b/i;

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
/** « vendredi 16 octobre » (jour UTC) ou null. */
export function dateLabelFr(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? WEEKDAY_FORMAT.format(t) : null;
}

function httpUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const normTitle = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = Math.PI / 180;
  const d = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(d)));
}

const dateOf = (item: LiveItem) => item.occurredAt ?? item.publishedAt;

interface Draft extends Omit<BriefingFact, "id" | "independentSources"> {
  official: boolean;
  /** Mesure de marché non officielle admise (nommée comme telle). */
  measure: boolean;
  /** Domaines indépendants (histoires de presse) ; sinon déduit des sources. */
  domains?: number;
}

const distinctDomains = (sources: FactSource[]) => new Set(sources.map((s) => domainOf(s.url) ?? s.name)).size;

function itemSource(item: LiveItem): FactSource {
  return { name: item.sourceName, url: httpUrl(item.url), date: dateOf(item), official: OFFICIAL_SOURCE_IDS.has(item.sourceId) && OFFICIAL_NATURES.has(item.nature) };
}

function draftFromItem(chapter: ChapterKey, item: LiveItem): Draft {
  const source = itemSource(item);
  const unofficial = UNOFFICIAL_MEASURES[item.sourceId] ?? null;
  return {
    chapter,
    title: item.title.trim(),
    summary: item.summary?.trim() || null,
    severity: item.severity,
    nature: item.nature,
    occurredAt: dateOf(item),
    countries: item.countries,
    lat: item.lat,
    lon: item.lon,
    metric: item.metric,
    fatalities: null,
    casualtiesAllowed: false, // les flux ne portent aucun bilan structuré : jamais de chiffre de victimes
    sources: [source],
    headlines: [],
    dateLabel: dateLabelFr(dateOf(item)),
    unofficialSource: unofficial,
    official: source.official,
    measure: Boolean(unofficial) && item.nature === "market_quote",
  };
}

function addSources(target: Draft, extra: FactSource[]) {
  for (const s of extra) {
    if (target.sources.length >= MAX_SOURCES_PER_FACT) break;
    if (!target.sources.some((t) => t.name === s.name && t.url === s.url)) target.sources.push(s);
  }
  target.official = target.sources.some((s) => s.official);
}

/** Fusionne les doublons : même titre, ou même séisme relayé par deux sources (≤ 200 km, ≤ 6 h, magnitudes proches). */
function dedupe(drafts: Draft[]): Draft[] {
  const out: Draft[] = [];
  for (const d of drafts) {
    const twin = out.find((o) => {
      if (normTitle(o.title) === normTitle(d.title)) return true;
      if (o.chapter !== "disasters" || !o.metric || !d.metric) return false;
      if (!/magnitude/i.test(o.metric.label) || !/magnitude/i.test(d.metric.label) || Math.abs(o.metric.value - d.metric.value) > 0.5) return false;
      if (o.lat === null || o.lon === null || d.lat === null || d.lon === null || !o.occurredAt || !d.occurredAt) return false;
      return distanceKm(o.lat, o.lon, d.lat, d.lon) <= 200 && Math.abs(Date.parse(o.occurredAt) - Date.parse(d.occurredAt)) <= 6 * 3600e3;
    });
    if (!twin) {
      out.push(d);
      continue;
    }
    addSources(twin, d.sources);
    if (rank(d.severity) > rank(twin.severity)) twin.severity = d.severity;
  }
  return out;
}

/** Garde-fou : 1 source officielle, OU une mesure de marché nommée non officielle, OU ≥ 2 domaines indépendants. */
export function passesGuardrail(sources: FactSource[], measure = false): boolean {
  if (sources.some((s) => s.official) || measure) return true;
  const domains = new Set(sources.map((s) => domainOf(s.url)).filter((d): d is string => !!d));
  return domains.size >= 2;
}

function inWindow(iso: string | null, now: number, hours: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= now - hours * 3600e3 && t <= now + 3600e3;
}

interface PressArticle extends StoryCandidate {
  date: string | null;
  sourceName: string;
  lat: number | null;
  lon: number | null;
  precise: boolean;
}

/** Une histoire de presse = un fait : titres (2-3), sources (une par domaine), jamais de bilan humain. */
function storyDrafts(chapter: ChapterKey, articles: PressArticle[], nature = "press_article"): Draft[] {
  return clusterStories(articles).map(({ items }) => {
    const located = items.find((a) => a.precise && a.lat !== null) ?? items.find((a) => a.lat !== null);
    const dates = items.map((a) => a.date).filter((x): x is string => !!x).sort();
    const latest = dates.at(-1) ?? null;
    const headlines = items.slice(0, MAX_HEADLINES).map((a) => stripOutlet(a.title));
    return {
      chapter,
      title: headlines[0],
      summary: `Histoire rapportée par ${items.length} médias indépendants (presse, non confirmé).`,
      severity: null,
      nature,
      occurredAt: latest,
      countries: [...new Set(items.flatMap((a) => a.countries))].slice(0, 3),
      lat: located?.lat ?? null,
      lon: located?.lon ?? null,
      metric: null,
      fatalities: null,
      casualtiesAllowed: false,
      sources: items.slice(0, MAX_SOURCES_PER_FACT).map((a) => ({ name: a.sourceName, url: httpUrl(a.url), date: a.date, official: false, title: stripOutlet(a.title) })),
      headlines,
      dateLabel: dateLabelFr(latest),
      unofficialSource: null,
      official: false,
      measure: false,
      domains: items.length,
    };
  });
}

function feedArticle(item: LiveItem): PressArticle | null {
  if (!hasRealTitle(item.title, item.url)) return null; // titre absent ou simple nom de domaine
  return { title: item.title, url: item.url, countries: item.countries, date: dateOf(item), sourceName: domainOf(item.url) ?? item.sourceName, lat: item.lat, lon: item.lon, precise: item.lat !== null };
}

/** Titre réel de l'article : champ `title`, sinon extrait de `source` (« GDELT · domaine · « titre » »). */
const conflictTitle = (e: ConflictEvent): string | null => e.title ?? /« (.+) »$/.exec(e.source ?? "")?.[1] ?? null;

function conflictArticle(e: ConflictEvent): PressArticle | null {
  const title = conflictTitle(e);
  if (!hasRealTitle(title, e.sourceUrl)) return null;
  return { title: title as string, url: e.sourceUrl, countries: [e.country], date: e.eventDate, sourceName: domainOf(e.sourceUrl) ?? "presse", lat: e.latitude, lon: e.longitude, precise: (e.geoPrecision ?? "city") === "city" };
}

function ucdpDraft(e: ConflictEvent): Draft {
  return {
    chapter: "conflicts",
    title: `${e.eventType} — ${[e.locality, e.country].filter(Boolean).join(", ")}`,
    summary: e.actors.length ? `Acteurs : ${e.actors.slice(0, 3).join(" ; ")}.` : null,
    severity: e.fatalities >= 25 ? "severe" : e.fatalities >= 5 ? "moderate" : "minor",
    nature: "conflict_record",
    occurredAt: e.eventDate,
    countries: [],
    lat: e.latitude,
    lon: e.longitude,
    metric: null,
    fatalities: e.fatalities,
    casualtiesAllowed: true, // incident codé par UCDP/ACLED : bilan structuré
    sources: [{ name: e.sourceDataset === "ucdp" ? "UCDP (Uppsala)" : "ACLED", url: httpUrl(e.sourceUrl), date: e.eventDate, official: true }],
    headlines: [],
    dateLabel: dateLabelFr(e.eventDate),
    unofficialSource: null,
    official: true,
    measure: false,
  };
}

function rankDrafts(drafts: Draft[]): Draft[] {
  const domains = (d: Draft) => d.domains ?? distinctDomains(d.sources);
  return [...drafts].sort(
    (a, b) =>
      Number(b.official) - Number(a.official) ||
      rank(b.severity) - rank(a.severity) ||
      (b.fatalities ?? 0) - (a.fatalities ?? 0) ||
      domains(b) - domains(a) ||
      Math.abs(b.metric?.value ?? 0) - Math.abs(a.metric?.value ?? 0) ||
      (b.occurredAt ?? "").localeCompare(a.occurredAt ?? "") ||
      a.title.localeCompare(b.title),
  );
}

const PREFIX: Record<ChapterKey, string> = { conflicts: "con", politics: "pol", disasters: "cat", economy: "eco", space: "esp", nuclear: "nuc", society: "soc", health: "san" };

interface Raw {
  items: LiveItem[];
  conflicts: ConflictEvent[];
}

/** Brouillons d'un chapitre pour une fenêtre donnée, après garde-fous, dédoublonnage et classement. */
function draftsFor(chapter: ChapterKey, raw: Raw, now: number, hours: number): Draft[] {
  const drafts: Draft[] = [];
  const press: LiveItem[] = [];
  for (const item of raw.items) {
    const date = dateOf(item);
    const scheduled = item.nature === "scheduled_event" && date !== null && Math.abs(Date.parse(date) - now) <= WINDOW_MS;
    if (!inWindow(date, now, hours) && !scheduled) continue;
    if (!item.title?.trim()) continue;
    if (item.nature === "press_article") {
      press.push(item);
      continue;
    }
    if (item.nature === "published_report") continue; // témoignage : n'établit pas un fait
    if (chapter === "economy" && !(item.metric?.unit === "%" && Math.abs(item.metric.value) >= MARKET_MIN_MOVE_PCT)) continue; // variation anodine
    if (chapter === "disasters" && item.severity !== null && rank(item.severity) < SEVERITY_RANK.minor) continue;
    drafts.push(draftFromItem(chapter, item));
  }
  const articles = press.map(feedArticle).filter((a): a is PressArticle => !!a);
  if (articles.length) drafts.push(...storyDrafts(chapter, articles));

  if (chapter === "conflicts") {
    const gdelt: PressArticle[] = [];
    for (const e of raw.conflicts) {
      if (!inWindow(e.eventDate, now, hours) || e.sourceDataset === "demo:seed" || e.confidence === "DEMO") continue;
      if (e.eventType === "Thermal anomaly" || e.sourceDataset === "firms") continue; // détection thermique : jamais un conflit
      if (e.sourceDataset === "ucdp" || e.sourceDataset === "acled") drafts.push(ucdpDraft(e));
      else if (e.sourceDataset === "gdelt" && e.eventType !== "Protests" && e.eventType !== "Riots") {
        const a = conflictArticle(e);
        if (a) gdelt.push(a);
      }
    }
    drafts.push(...storyDrafts("conflicts", gdelt));
  }
  return rankDrafts(dedupe(drafts).filter((d) => passesGuardrail(d.sources, d.measure))).slice(0, MAX_FACTS_PER_CHAPTER);
}

/** Constitue les faits par chapitre : garde-fous, dédoublonnage, classement, bornage, fenêtres élargies si vide. */
export async function collectFacts(deps: CollectDeps): Promise<Collected> {
  const now = (deps.now ?? Date.now)();
  const notes: string[] = [];
  const raw = Object.fromEntries(CHAPTER_KEYS.map((k) => [k, { items: [], conflicts: [] } as Raw])) as Record<ChapterKey, Raw>;

  try {
    const feeds = await deps.getFeeds();
    for (const s of feeds.sources) if (s.status !== "ok" && CATEGORY_TO_CHAPTER[s.category]) notes.push(`source ${s.sourceName} : ${s.status}`);
    for (const item of feeds.items) {
      let chapter = CATEGORY_TO_CHAPTER[item.category];
      if (!chapter) continue; // « uap » et autres : hors bilan
      if (chapter === "politics" && NUCLEAR_TITLE.test(item.title)) chapter = "nuclear"; // publication ONU/AIEA sur le nucléaire
      raw[chapter].items.push(item);
    }
  } catch {
    notes.push("flux mondiaux indisponibles");
  }
  try {
    raw.conflicts.conflicts = await deps.getConflictEvents();
  } catch {
    notes.push("données de conflits indisponibles");
  }

  const facts = {} as Record<ChapterKey, BriefingFact[]>;
  const windowHours = {} as Record<ChapterKey, number>;
  for (const key of CHAPTER_KEYS) {
    let kept: Draft[] = [];
    let used = WINDOWS_HOURS[key][0];
    for (const hours of WINDOWS_HOURS[key]) {
      used = hours;
      kept = draftsFor(key, raw[key], now, hours);
      if (kept.length) break;
    }
    windowHours[key] = used;
    facts[key] = kept.map((d, i) => {
      const { official: _o, measure: _m, domains, ...rest } = d;
      void _o;
      void _m;
      return { ...rest, id: `${PREFIX[key]}-${i + 1}`, independentSources: domains ?? distinctDomains(d.sources) };
    });
  }
  return { facts, windowHours, notes };
}
