import { FEED_CATEGORIES, type FeedCategory, type FeedsResponse, type FeedSourceState, type LiveItem } from "@/types/feeds";
import type { WorldIndex } from "@/lib/geo/world";
import { disasterSources } from "./disaster";
import { economySources } from "./economy";
import { healthSources } from "./health";
import { nuclearSources } from "./nuclear";
import { socialSources } from "./social";
import { spaceSources } from "./space";
import { unSources } from "./un";
import { uapSources } from "./uap";
import { runSource, type FeedSourceDef } from "./util";

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
  ...EXTRA_SOURCES,
];

export interface GetFeedsQuery {
  category?: string | null;
  country?: string | null;
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

/** Date propre décroissante ; à égalité, identifiant pour un ordre stable. */
export function sortItems(items: LiveItem[]): LiveItem[] {
  return [...items].sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || a.id.localeCompare(b.id));
}

export function parseCategory(value: string | null | undefined): FeedCategory | null {
  const v = (value ?? "").trim().toLowerCase();
  return (FEED_CATEGORIES as readonly string[]).includes(v) ? (v as FeedCategory) : null;
}

export async function getFeeds(
  query: GetFeedsQuery = {},
  options: { sources?: FeedSourceDef[]; getIndex?: () => Promise<WorldIndex | null> } = {},
): Promise<FeedsResponse> {
  const category = parseCategory(query.category);
  const country = query.country?.trim().toUpperCase() || null;
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

  const filtered = country ? items.filter((item) => item.countries.includes(country)) : items;
  return { generatedAt: new Date().toISOString(), items: sortItems(filtered).slice(0, limit), sources: states };
}
