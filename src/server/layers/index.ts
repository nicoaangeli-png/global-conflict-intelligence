import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { LAYER_IDS, type LayerId, type LayerResponse } from "@/types/layers";
import { FeedError } from "@/server/feeds/util";
import { recordAttempt, registerSource, type SourceDescriptor } from "@/server/health/registry";
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

/** Descripteur de santé d'un calque (registre commun) ; rafraîchi chaque jour. */
function layerDescriptor(id: LayerId): SourceDescriptor {
  const meta = metadata[id];
  return { id: `layer:${id}`, kind: "layer", name: `${meta.title} (${meta.sourceName})`, category: "reference", homepage: meta.homepage, license: meta.license, nature: "référentiel", staleAfterMs: 3 * DAY_MS };
}

// Calques chargés à la demande : « pending » tant qu'aucun n'a été affiché.
for (const id of LAYER_IDS) registerSource(layerDescriptor(id));

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
  /** Nombre d'éléments connus, ou null si le calque n'a pas encore été chargé. */
  itemCount: number | null;
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

/** Délai avant nouvel essai après un échec de la source. */
export const ERROR_RETRY_MS = 10 * 60_000;

/** Charge un calque de référence : cache mémoire puis disque ; jamais d'exception publique. */
export async function loadLayer(id: LayerId, deps: LayerDeps = {}): Promise<LayerResponse> {
  const nowMs = (deps.now ?? Date.now)();
  const dir = deps.cacheDir ?? defaultDir();
  const existing = memory.get(id);
  if (existing && nowMs - existing.checkedAt < DAY_MS) return existing.inflight ? await existing.inflight : existing.response;
  if (existing?.inflight) return existing.inflight;

  const task = (async () => {
    const disk = await readCached(id, dir);
    const descriptor = layerDescriptor(id);
    if (disk && nowMs - disk.checkedAt < DAY_MS) {
      memory.set(id, { ...disk });
      if (disk.response.status !== "error") {
        recordAttempt(descriptor, { ok: true, cached: true, startedAt: disk.checkedAt, finishedAt: disk.checkedAt, itemCount: disk.response.features.length, newestDataAt: disk.response.asOf, warning: disk.response.status === "stale" ? disk.response.message : null });
      }
      return disk.response;
    }
    const previous = existing?.response ?? disk?.response;
    const startedAt = Date.now();
    try {
      const response = await loadFresh(id, nowMs);
      recordAttempt(descriptor, { ok: true, startedAt, finishedAt: Date.now(), itemCount: response.features.length, newestDataAt: response.asOf });
      memory.set(id, { checkedAt: nowMs, response });
      await writeCached(id, dir, nowMs, response);
      return response;
    } catch (error) {
      // Échec : nouvel essai après ERROR_RETRY_MS, et non 24 h plus tard.
      const retryAt = nowMs - DAY_MS + ERROR_RETRY_MS;
      recordAttempt(descriptor, { ok: false, startedAt, finishedAt: Date.now(), error: readableError(error), servedItems: previous?.features.length ?? 0 });
      if (previous?.features.length) {
        const response: LayerResponse = {
          ...previous,
          status: "stale",
          message: `Actualisation impossible : ${readableError(error)} Affichage du dernier cache valide.`,
        };
        memory.set(id, { checkedAt: retryAt, response });
        await writeCached(id, dir, retryAt, response);
        return response;
      }
      const response: LayerResponse = { ...metadata[id], asOf: null, fetchedAt: new Date(nowMs).toISOString(), status: "error", message: readableError(error), features: [] };
      memory.set(id, { checkedAt: retryAt, response });
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

/**
 * Catalogue : métadonnées + nombre d'éléments DÉJÀ connus (mémoire ou cache disque).
 * Ne déclenche aucun appel réseau : ouvrir le menu « Calques » ne doit pas télécharger
 * les quatre jeux complets (jusqu'à ~750 Ko chacun) ni solliciter Wikidata/OFAC.
 * Un calque jamais chargé renvoie `itemCount: null` ; l'interface affiche
 * « Chargé à l'allumage ».
 */
export async function listLayers(deps: LayerDeps = {}): Promise<LayerSummary[]> {
  const dir = deps.cacheDir ?? defaultDir();
  return Promise.all(
    LAYER_IDS.map(async (id) => {
      const entry = memory.get(id);
      const inMemory = entry && (entry.response.features.length > 0 || !entry.inflight) ? entry.response : null;
      const data = inMemory ?? (await readCached(id, dir))?.response ?? null;
      if (!data) {
        return { ...metadata[id], asOf: null, fetchedAt: "", status: "ok" as const, message: null, itemCount: null };
      }
      const { features, ...summary } = data;
      return { ...summary, itemCount: features.length };
    }),
  );
}

/** Remise à zéro du cache mémoire, réservée aux tests. */
export function resetLayersCache(): void {
  memory.clear();
}

export { isLayerId };
