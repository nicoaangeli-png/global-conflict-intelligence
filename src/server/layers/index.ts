import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { LAYER_IDS, type LayerId, type LayerResponse } from "@/types/layers";
import { FeedError } from "@/server/feeds/util";
import { loadSubmarineCables, SUBMARINE_CABLE_LICENSE } from "./cables";
import { loadSanctions } from "./sanctions";
import { loadMilitaryBases, loadNuclearPlants, MILITARY_BASE_LIMIT } from "./wikidata";

export { parseSubmarineCables, SUBMARINE_CABLE_LICENSE } from "./cables";
export { parseSanctions, parseCsv } from "./sanctions";
export { buildMilitaryBasesQuery, buildNuclearPlantsQuery, parseMilitaryBases, parseNuclearPlants, MILITARY_BASE_LIMIT } from "./wikidata";

const DAY_MS = 24 * 60 * 60 * 1000;

type LayerMeta = Omit<LayerResponse, "asOf" | "fetchedAt" | "status" | "message" | "features">;
type StoredLayer = { checkedAt: string; response: LayerResponse };
type MemoryEntry = { checkedAt: number; response: LayerResponse; inflight?: Promise<LayerResponse> };

const metadata: Record<LayerId, LayerMeta> = {
  nuclear_plants: {
    layerId: "nuclear_plants",
    title: "Centrales nucléaires",
    sourceName: "Wikidata",
    homepage: "https://www.wikidata.org/",
    license: "CC0 1.0 Universal",
    caveat: "Couverture Wikidata non exhaustive ; cette base collaborative n'est pas une source officielle. PRIS/AIEA n'est pas interrogé car inaccessible aux robots.",
  },
  military_bases: {
    layerId: "military_bases",
    title: "Bases militaires",
    sourceName: "Wikidata",
    homepage: "https://www.wikidata.org/",
    license: "CC0 1.0 Universal",
    caveat: `Couverture Wikidata inégale selon les pays et ne reflétant pas les déploiements temporaires. Sélection classée par nombre de liens Wikipédia (sitelinks), puis bornée aux ${MILITARY_BASE_LIMIT.toLocaleString("fr-FR")} installations issues de classes militaires explicites ; casernes et garnisons exigent au moins cinq sitelinks. Les bases fermées, détruites, abandonnées et les types civils sont exclus. Les dates de fermeture restent incomplètes dans Wikidata.`,
  },
  submarine_cables: {
    layerId: "submarine_cables",
    title: "Câbles sous-marins",
    sourceName: "TeleGeography Submarine Cable Map",
    homepage: "https://www.submarinecablemap.com/",
    license: SUBMARINE_CABLE_LICENSE,
    caveat: "Les tracés proviennent de TeleGeography ; les pays d'atterrissement ne sont pas déduits lorsqu'ils ne sont pas publiés dans le GeoJSON. La licence CC BY-SA 4.0 impose attribution et partage à l'identique ; vérifier l'adéquation de l'usage avant toute redistribution.",
  },
  sanctions: {
    layerId: "sanctions",
    title: "Sanctions OFAC par pays d'adresse",
    sourceName: "U.S. Treasury OFAC — SDN List",
    homepage: "https://sanctionssearch.ofac.treas.gov/",
    license: "Domaine public (gouvernement fédéral des États-Unis) ; vérifier les conditions d'utilisation OFAC.",
    caveat: "Liste des États-Unis uniquement (pas l'UE ni l'ONU) ; une entité est comptée dans chaque pays où elle a une adresse ; ce n'est pas une mesure de risque.",
  },
};

const holder = globalThis as unknown as { __orbitalLayers?: Map<LayerId, MemoryEntry> };
const memory = (holder.__orbitalLayers ??= new Map<LayerId, MemoryEntry>());
const defaultDir = () => path.join(process.cwd(), "data", "layers");

export interface LayerDeps {
  /** Horloge injectable pour les tests. */
  now?: () => number;
  /** Répertoire de cache injectable pour les tests. */
  cacheDir?: string;
}

export interface LayerSummary extends Omit<LayerResponse, "features"> {
  itemCount: number;
}

function isLayerId(value: string): value is LayerId {
  return (LAYER_IDS as readonly string[]).includes(value);
}

function validStored(value: unknown, id: LayerId): value is StoredLayer {
  if (!value || typeof value !== "object") return false;
  const stored = value as Partial<StoredLayer>;
  const response = stored.response;
  return typeof stored.checkedAt === "string" && !!response && response.layerId === id && Array.isArray(response.features) && typeof response.fetchedAt === "string";
}

async function readCached(id: LayerId, dir: string): Promise<{ checkedAt: number; response: LayerResponse } | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(path.join(dir, `${id}.json`), "utf8"));
    if (!validStored(raw, id)) return null;
    const checkedAt = Date.parse(raw.checkedAt);
    return Number.isFinite(checkedAt) ? { checkedAt, response: raw.response } : null;
  } catch {
    return null;
  }
}

async function writeCached(id: LayerId, dir: string, checkedAt: number, response: LayerResponse): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    const destination = path.join(dir, `${id}.json`);
    const temporary = `${destination}.tmp`;
    await writeFile(temporary, JSON.stringify({ checkedAt: new Date(checkedAt).toISOString(), response } satisfies StoredLayer));
    await rename(temporary, destination);
  } catch {
    // Le cache disque est une optimisation : une erreur d'écriture ne masque jamais la réponse source.
  }
}

function readableError(error: unknown): string {
  return error instanceof FeedError ? error.message : "Données reçues dans un format inattendu ; calque indisponible.";
}

async function loadFresh(id: LayerId, nowMs: number): Promise<LayerResponse> {
  const fetchedAt = new Date(nowMs).toISOString();
  switch (id) {
    case "nuclear_plants":
      return { ...metadata[id], asOf: null, fetchedAt, status: "ok", message: null, features: await loadNuclearPlants(nowMs) };
    case "military_bases":
      return { ...metadata[id], asOf: null, fetchedAt, status: "ok", message: null, features: await loadMilitaryBases() };
    case "submarine_cables":
      return { ...metadata[id], asOf: null, fetchedAt, status: "ok", message: null, features: await loadSubmarineCables() };
    case "sanctions": {
      const loaded = await loadSanctions();
      return { ...metadata[id], asOf: loaded.asOf, fetchedAt, status: "ok", message: null, features: loaded.features };
    }
  }
}

/** Charge un calque de référence : cache mémoire puis disque ; jamais d'exception publique. */
export async function loadLayer(id: LayerId, deps: LayerDeps = {}): Promise<LayerResponse> {
  const nowMs = (deps.now ?? Date.now)();
  const dir = deps.cacheDir ?? defaultDir();
  const existing = memory.get(id);
  if (existing && nowMs - existing.checkedAt < DAY_MS) return existing.inflight ? await existing.inflight : existing.response;
  if (existing?.inflight) return existing.inflight;

  const task = (async () => {
    const disk = await readCached(id, dir);
    if (disk && nowMs - disk.checkedAt < DAY_MS) {
      memory.set(id, { ...disk });
      return disk.response;
    }
    const previous = existing?.response ?? disk?.response;
    try {
      const response = await loadFresh(id, nowMs);
      memory.set(id, { checkedAt: nowMs, response });
      await writeCached(id, dir, nowMs, response);
      return response;
    } catch (error) {
      if (previous?.features.length) {
        const response: LayerResponse = {
          ...previous,
          status: "stale",
          message: `Actualisation impossible : ${readableError(error)} Affichage du dernier cache valide.`,
        };
        memory.set(id, { checkedAt: nowMs, response });
        await writeCached(id, dir, nowMs, response);
        return response;
      }
      const response: LayerResponse = { ...metadata[id], asOf: null, fetchedAt: new Date(nowMs).toISOString(), status: "error", message: readableError(error), features: [] };
      memory.set(id, { checkedAt: nowMs, response });
      return response;
    }
  })();
  memory.set(id, { checkedAt: existing?.checkedAt ?? 0, response: existing?.response ?? { ...metadata[id], asOf: null, fetchedAt: new Date(nowMs).toISOString(), status: "error", message: null, features: [] }, inflight: task });
  try {
    return await task;
  } finally {
    const current = memory.get(id);
    if (current?.inflight === task) current.inflight = undefined;
  }
}

export async function listLayers(deps: LayerDeps = {}): Promise<LayerSummary[]> {
  const layers = await Promise.all(LAYER_IDS.map((id) => loadLayer(id, deps)));
  return layers.map(({ features, ...layer }) => ({ ...layer, itemCount: features.length }));
}

/** Remise à zéro du cache mémoire, réservée aux tests. */
export function resetLayersCache(): void {
  memory.clear();
}

export { isLayerId };
