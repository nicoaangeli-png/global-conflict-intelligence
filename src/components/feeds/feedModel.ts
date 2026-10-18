/**
 * Logique pure du « FIL MONDIAL » (sans React, testée dans tests/ui-feeds.test.ts).
 *
 * - thèmes de navigation et couleurs de calque ;
 * - libellés honnêtes de nature (« Presse — non confirmé »…) ;
 * - fraîcheur (« DIRECT » si < 2 h), période, tri chronologique ;
 * - fusion des réponses par catégorie et état réel des sources.
 */
import { FEED_CATEGORIES, type FeedCategory, type FeedNature, type FeedSourceState, type FeedsResponse, type LiveItem } from "@/types/feeds";
import type { Locale } from "@/lib/i18n";

/** Thème de navigation : tout, conflits armés (données du store) ou une catégorie de flux. */
export type ThemeKey = "all" | "conflict" | FeedCategory;

export const THEMES: readonly ThemeKey[] = ["all", "conflict", "social", "disaster", "health", "un", "space", "nuclear", "economy", "uap"];

export const THEME_LABELS: Record<ThemeKey, { fr: string; en: string }> = {
  all: { fr: "Tout", en: "All" },
  conflict: { fr: "Conflits", en: "Conflicts" },
  social: { fr: "Social", en: "Social" },
  disaster: { fr: "Catastrophes", en: "Disasters" },
  health: { fr: "Santé", en: "Health" },
  un: { fr: "ONU", en: "UN" },
  space: { fr: "Espace", en: "Space" },
  nuclear: { fr: "Nucléaire", en: "Nuclear" },
  economy: { fr: "Économie", en: "Economy" },
  uap: { fr: "OVNI", en: "UAP" },
};

/** Couleur de calque par thème (globe + pastilles). Conflits = rouge historique du globe. */
export const THEME_COLORS: Record<ThemeKey, string> = {
  all: "#7fd4ff",
  conflict: "#ff4a3f",
  social: "#ff9f1c",
  disaster: "#ffd166",
  health: "#5ee6a8",
  un: "#5b9dff",
  space: "#c3a6ff",
  nuclear: "#d4ff4f",
  economy: "#3fe0d0",
  uap: "#ff7ad9",
};

export const NATURE_LABELS: Record<FeedNature, { fr: string; en: string }> = {
  official_alert: { fr: "Alerte officielle", en: "Official alert" },
  sensor_measurement: { fr: "Mesure", en: "Measurement" },
  official_publication: { fr: "Publication officielle", en: "Official publication" },
  press_article: { fr: "Presse — non confirmé", en: "Press — unconfirmed" },
  published_report: { fr: "Signalement publié — non vérifié", en: "Published report — unverified" },
  scheduled_event: { fr: "Planifié", en: "Scheduled" },
  market_quote: { fr: "Cotation", en: "Market quote" },
};

/** Teinte du badge de nature : officiel/mesure = glace, presse/témoignage = ambre. */
export const NATURE_TONE: Record<FeedNature, "official" | "unconfirmed" | "neutral"> = {
  official_alert: "official",
  sensor_measurement: "official",
  official_publication: "official",
  press_article: "unconfirmed",
  published_report: "unconfirmed",
  scheduled_event: "neutral",
  market_quote: "neutral",
};

export const label = (entry: { fr: string; en: string }, locale: Locale) => entry[locale] ?? entry.fr;

/** Seuil de la pastille « DIRECT ». */
export const LIVE_WINDOW_MS = 2 * 3600e3;

/** Date propre de l'élément : l'événement s'il est connu, sinon la publication. Jamais la collecte. */
export function itemTime(item: LiveItem): string | null {
  return item.occurredAt ?? item.publishedAt ?? null;
}

/** Élément passé daté de moins de 2 h (un lancement futur n'est pas « en direct »). */
export function isLive(item: LiveItem, now = Date.now()): boolean {
  const iso = itemTime(item);
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const age = now - t;
  return age >= 0 && age < LIVE_WINDOW_MS;
}

/** Éclat décroissant avec l'âge : < 6 h plein, < 24 h moyen, au-delà atténué. */
export function ageBrightness(item: LiveItem, now = Date.now()): number {
  const iso = itemTime(item);
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return 0.4;
  const age = now - t;
  if (age < 0) return 0.85; // planifié : visible sans halo
  if (age < 6 * 3600e3) return 1;
  if (age < 24 * 3600e3) return 0.7;
  return 0.4;
}

export type PeriodKey = "24h" | "7d" | "30d" | "all";

/**
 * Période affichée par défaut selon le rythme de publication réel de chaque thème :
 * 24 h pour les flux continus, 7 j pour les publications espacées (ONU, OMS…),
 * tout pour les rapports OVNI (rares, publiés après enquête).
 */
export function defaultPeriod(theme: ThemeKey): PeriodKey {
  if (theme === "uap") return "all";
  if (theme === "un" || theme === "health" || theme === "nuclear" || theme === "space") return "7d";
  return "24h";
}
export const PERIODS: { key: PeriodKey; fr: string; en: string; ms: number | null }[] = [
  { key: "24h", fr: "24 h", en: "24 h", ms: 24 * 3600e3 },
  { key: "7d", fr: "7 j", en: "7 d", ms: 7 * 86400e3 },
  { key: "30d", fr: "30 j", en: "30 d", ms: 30 * 86400e3 },
  { key: "all", fr: "Tout", en: "All", ms: null },
];

/**
 * Garde les éléments de la période. Un élément planifié (futur) n'est gardé que
 * s'il tombe dans la même fenêtre vers l'avant (« 24 h » = prochaines 24 h) ;
 * un élément sans date n'entre que dans « Tout » (on ne lui invente pas d'âge).
 */
export function inPeriod(item: LiveItem, period: PeriodKey, now = Date.now()): boolean {
  const ms = PERIODS.find((p) => p.key === period)?.ms ?? null;
  if (ms === null) return true;
  const iso = itemTime(item);
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return Math.abs(now - t) <= ms;
}

/**
 * Tri chronologique décroissant (le plus récent d'abord). Les éléments planifiés
 * (futurs) sont placés à part : en tête, du plus proche au plus lointain, si
 * `futureFirst` (onglet Espace), sinon après les éléments passés — ils ne doivent
 * pas masquer l'actualité.
 */
export function sortChronological(items: LiveItem[], now = Date.now(), futureFirst = false): LiveItem[] {
  const key = (item: LiveItem) => {
    const iso = itemTime(item);
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isNaN(t) ? -Infinity : t;
  };
  return [...items].sort((a, b) => {
    const ta = key(a);
    const tb = key(b);
    const fa = ta > now;
    const fb = tb > now;
    if (fa !== fb) return (fa ? -1 : 1) * (futureFirst ? 1 : -1);
    if (fa && fb) return ta - tb || a.id.localeCompare(b.id);
    return tb - ta || a.id.localeCompare(b.id);
  });
}

/** Élément daté dans le futur (lancement planifié…). */
export function isFuture(item: LiveItem, now = Date.now()): boolean {
  const iso = itemTime(item);
  const t = iso ? Date.parse(iso) : NaN;
  return !Number.isNaN(t) && t > now;
}

/**
 * Filtre d'affichage du fil pour un thème (« conflict » n'a pas d'élément de flux).
 * « Tout » = l'actualité : sans éléments futurs (ils restent dans Espace, « À venir »)
 * ni cotations/devises (onglet Économie et fiche pays).
 */
export function itemsForTheme(items: LiveItem[], theme: ThemeKey, now = Date.now()): LiveItem[] {
  if (theme === "all") return items.filter((item) => item.category !== "economy" && item.nature !== "market_quote" && !isFuture(item, now));
  if (theme === "conflict") return [];
  return items.filter((item) => item.category === theme);
}

/** Résultat d'une requête par catégorie (succès ou échec réseau / HTTP). */
export type CategoryResult =
  | { category: FeedCategory; ok: true; body: FeedsResponse }
  | { category: FeedCategory; ok: false; error: string };

export interface MergedFeeds {
  items: LiveItem[];
  sources: FeedSourceState[];
  /** Catégories dont la requête elle-même a échoué (route absente, 500…). */
  failedCategories: { category: FeedCategory; error: string }[];
  generatedAt: string | null;
}

/** Fusionne les réponses par catégorie, sans doublon d'identifiant ni de source. */
export function mergeCategoryResults(results: CategoryResult[]): MergedFeeds {
  const items = new Map<string, LiveItem>();
  const sources = new Map<string, FeedSourceState>();
  const failedCategories: MergedFeeds["failedCategories"] = [];
  let generatedAt: string | null = null;
  for (const result of results) {
    if (!result.ok) {
      failedCategories.push({ category: result.category, error: result.error });
      continue;
    }
    for (const item of result.body.items ?? []) if (!items.has(item.id)) items.set(item.id, item);
    for (const state of result.body.sources ?? []) sources.set(state.sourceId, state);
    if (!generatedAt || (result.body.generatedAt && result.body.generatedAt > generatedAt)) generatedAt = result.body.generatedAt;
  }
  return { items: [...items.values()], sources: [...sources.values()], failedCategories, generatedAt };
}

/** Date réelle de la donnée la plus récente reçue pour une source (jamais la date de collecte). */
export function latestDataDate(items: LiveItem[], sourceId: string, now = Date.now()): string | null {
  let best: string | null = null;
  for (const item of items) {
    if (item.sourceId !== sourceId) continue;
    const iso = itemTime(item);
    if (!iso) continue;
    const t = Date.parse(iso);
    if (Number.isNaN(t) || t > now) continue; // un lancement futur n'est pas une « donnée reçue »
    if (!best || t > Date.parse(best)) best = iso;
  }
  return best;
}

/** Message d'état lisible d'une source de flux. */
export function sourceStatusLabel(state: FeedSourceState, locale: Locale): string {
  const fr = locale === "fr";
  switch (state.status) {
    case "ok":
      return fr ? "Opérationnelle" : "Operational";
    case "stale":
      return fr ? "Données anciennes (cache)" : "Stale (cached)";
    case "not_configured":
      return fr ? "Non branchée" : "Not connected";
    default:
      return fr ? "Indisponible" : "Unavailable";
  }
}

/** Sources en échec à signaler dans le fil d'un thème (« Source indisponible : … »). */
export function failingSourcesFor(sources: FeedSourceState[], theme: ThemeKey): FeedSourceState[] {
  return sources.filter((s) => (s.status === "error" || s.status === "stale") && (theme === "all" || s.category === theme));
}

/** Catégories effectivement demandées au serveur (une requête par catégorie). */
export const FETCH_CATEGORIES: readonly FeedCategory[] = FEED_CATEGORIES;

/** Drapeau emoji depuis un code ISO 3166-1 alpha-2 (« FR » → 🇫🇷) ; null si code invalide. */
export function flagEmoji(iso2: string | null | undefined): string | null {
  if (!iso2 || !/^[A-Za-z]{2}$/.test(iso2)) return null;
  const base = 0x1f1e6;
  const up = iso2.toUpperCase();
  return String.fromCodePoint(base + up.charCodeAt(0) - 65, base + up.charCodeAt(1) - 65);
}

/** Sections de la fiche pays construites sur les flux. */
export type CountrySectionKey = "social" | "disaster" | "health" | "un" | "nuclear" | "space" | "uap";

/**
 * Répartit les éléments d'un pays par section : éléments des dernières 24 h,
 * plus le dernier élément plus ancien (affiché comme tel) si la fenêtre est vide.
 */
export function countrySections(
  items: LiveItem[],
  iso3: string,
  now = Date.now(),
): Record<CountrySectionKey, { recent: LiveItem[]; older: LiveItem | null }> {
  const keys: CountrySectionKey[] = ["social", "disaster", "health", "un", "nuclear", "space", "uap"];
  const out = {} as Record<CountrySectionKey, { recent: LiveItem[]; older: LiveItem | null }>;
  for (const key of keys) {
    const mine = sortChronological(items.filter((item) => item.category === key && item.countries.includes(iso3)), now);
    const recent = mine.filter((item) => inPeriod(item, "24h", now));
    const older = recent.length ? null : mine.find((item) => !inPeriod(item, "24h", now) && itemTime(item) !== null && Date.parse(itemTime(item)!) <= now) ?? null;
    out[key] = { recent, older };
  }
  return out;
}

/** Cotations d'un pays : indices boursiers et devise, plus récentes d'abord, une par instrument. */
export function countryMarkets(items: LiveItem[], iso3: string): LiveItem[] {
  const quotes = items.filter((item) => item.category === "economy" && item.countries.includes(iso3));
  const seen = new Set<string>();
  const out: LiveItem[] = [];
  for (const item of sortChronological(quotes)) {
    // Identifiant « source:instrument:date » → une ligne par instrument.
    const instrument = item.id.split(":").slice(0, -1).join(":") || item.id;
    if (seen.has(instrument)) continue;
    seen.add(instrument);
    out.push(item);
  }
  return out.sort((a, b) => Number(a.sourceId !== "yahoo-indices") - Number(b.sourceId !== "yahoo-indices"));
}
