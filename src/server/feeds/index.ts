import { FEED_CATEGORIES, type FeedCategory, type FeedsResponse, type FeedSourceState, type LiveItem } from "@/types/feeds";
import type { WorldIndex } from "@/lib/geo/world";
import { disasterSources } from "./disaster";
import { economySources } from "./economy";
import { healthSources } from "./health";
import { infrastructureSources } from "./infrastructure";
import { maritimeSources } from "./maritime";
import { militarySources } from "./military";
import { ensureMobileSnapshots } from "./mobileSnapshot";
import { nuclearSources } from "./nuclear";
import { socialSources } from "./social";
import { spaceSources } from "./space";
import { unSources } from "./un";
import { uapSources } from "./uap";
import { feedDescriptor, runSource, type FeedSourceDef } from "./util";
import { registerSource } from "@/server/health/registry";
import { weatherSources } from "./weather";

/**
 * Registre des sources de flux mondiaux.
 *
 * Catégorie « social » : GDELT 2.0 événements (`./social`), branchée via `EXTRA_SOURCES`.
 */
const EXTRA_SOURCES: FeedSourceDef[] = [...socialSources];

export const FEED_SOURCES: FeedSourceDef[] = [
  ...disasterSources,
  ...healthSources,
  ...spaceSources,
  ...nuclearSources,
  ...unSources,
  ...uapSources,
  ...economySources,
  ...militarySources,
  ...maritimeSources,
  ...weatherSources,
  ...infrastructureSources,
  ...EXTRA_SOURCES,
];

// Toutes les sources apparaissent dans l'état de santé dès le démarrage (« pending »).
for (const def of FEED_SOURCES) registerSource(feedDescriptor(def));

export interface GetFeedsQuery {
  category?: string | null;
  country?: string | null;
  /** Borne inférieure UTC, appliquée avant la limite de résultats. */
  sinceMs?: number | null;
  limit?: number | null;
}

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 1000;

// Chargement paresseux de l'index géographique : `@/server/world` est réservé au serveur Next.
async function defaultIndex(): Promise<WorldIndex | null> {
  try {
    const { loadWorldIndex } = await import("@/server/world");
    return await loadWorldIndex();
  } catch {
    return null;
  }
}

const sortKey = (item: LiveItem): string => item.occurredAt ?? item.publishedAt ?? "";
const sortTime = (item: LiveItem): number => {
  const time = Date.parse(sortKey(item));
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
};

/** Date propre décroissante ; à égalité, identifiant pour un ordre stable. */
export function sortItems(items: LiveItem[]): LiveItem[] {
  return [...items].sort((a, b) => sortTime(b) - sortTime(a) || a.id.localeCompare(b.id));
}

export function parseCategory(value: string | null | undefined): FeedCategory | null {
  const v = (value ?? "").trim().toLowerCase();
  return (FEED_CATEGORIES as readonly string[]).includes(v) ? (v as FeedCategory) : null;
}

export async function getFeeds(
  query: GetFeedsQuery = {},
  options: { sources?: FeedSourceDef[]; getIndex?: () => Promise<WorldIndex | null> } = {},
): Promise<FeedsResponse> {
  // Trajets d'avions et de navires sauvegardés : un redémarrage ne les efface plus.
  ensureMobileSnapshots();
  const category = parseCategory(query.category);
  const country = query.country?.trim().toUpperCase() || null;
  const sinceMs = typeof query.sinceMs === "number" && Number.isFinite(query.sinceMs) ? query.sinceMs : null;
  const limit = Math.min(Math.max(Math.floor(Number(query.limit) || DEFAULT_LIMIT), 1), MAX_LIMIT);
  const getIndex = options.getIndex ?? defaultIndex;
  // Une catégorie demandée mais inconnue ne renvoie rien (plutôt que tout).
  const requested = query.category?.trim();
  const sources = (options.sources ?? FEED_SOURCES).filter((s) => (requested ? s.category === category : true));

  const settled = await Promise.allSettled(sources.map((def) => runSource(def, getIndex)));
  const items: LiveItem[] = [];
  const states: FeedSourceState[] = [];
  settled.forEach((result, i) => {
    const def = sources[i];
    if (result.status === "fulfilled") {
      items.push(...result.value.items);
      states.push(result.value.state);
    } else {
      // runSource ne lève pas ; garde-fou ultime pour ne jamais casser la route.
      states.push({
        sourceId: def.sourceId,
        sourceName: def.sourceName,
        category: def.category,
        status: "error",
        message: "Erreur interne lors de la lecture de la source.",
        fetchedAt: null,
        itemCount: 0,
        homepage: def.homepage,
        license: def.license,
      });
    }
  });

  const filtered = items.filter((item) => {
    if (country && !item.countries.includes(country)) return false;
    if (sinceMs === null) return true;
    const time = sortTime(item);
    return Number.isFinite(time) && time >= sinceMs;
  });
  return { generatedAt: new Date().toISOString(), items: sortItems(filtered).slice(0, limit), sources: states };
}
