import "server-only";
import { SOURCE_HEALTH_STATUSES, type SourceHealth, type SourceHealthStatus, type SourceKind, type SourcesStatusResponse } from "@/types/health";
import { redactSecrets } from "@/server/security/redact";

/**
 * Registre de santé des sources, alimenté par chaque famille au fil de ses tentatives
 * (flux, connecteurs, calques). Lecture seule pour les routes : consulter l'état ne
 * déclenche jamais d'appel réseau.
 *
 * Mémoire du processus : l'état repart de « pending » à chaque redémarrage.
 */

export interface SourceDescriptor {
  id: string;
  kind: SourceKind;
  name: string;
  category: string;
  homepage?: string | null;
  license?: string | null;
  nature?: string | null;
  quota?: string | null;
  /** Au-delà, un dernier succès trop ancien rend la source « stale » (ex. 3 × TTL). */
  staleAfterMs?: number | null;
}

export type AttemptOutcome =
  /** `cached` : données relues d'un cache local valide (aucune latence réseau mesurée). */
  | { ok: true; startedAt: number; finishedAt: number; itemCount: number; newestDataAt?: string | null; warning?: string | null; cached?: boolean }
  /** `servedItems` : éléments encore servis malgré l'échec (défaut : ceux du dernier succès). */
  | { ok: false; startedAt: number; finishedAt: number; error: string; servedItems?: number };

type Entry = {
  descriptor: SourceDescriptor;
  status: Exclude<SourceHealthStatus, "stale"> | "stale";
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  newestDataAt: string | null;
  latencyMs: number | null;
  itemCount: number;
  lastError: string | null;
};

const holder = globalThis as unknown as { __orbitalSourceHealth?: Map<string, Entry> };
const entries = () => (holder.__orbitalSourceHealth ??= new Map<string, Entry>());

function entryFor(descriptor: SourceDescriptor): Entry {
  const map = entries();
  let entry = map.get(descriptor.id);
  if (!entry) {
    entry = { descriptor, status: "pending", lastAttemptAt: null, lastSuccessAt: null, newestDataAt: null, latencyMs: null, itemCount: 0, lastError: null };
    map.set(descriptor.id, entry);
  } else {
    entry.descriptor = { ...entry.descriptor, ...descriptor };
  }
  return entry;
}

/** Déclare une source (état « pending » tant qu'elle n'a pas été interrogée). */
export function registerSource(descriptor: SourceDescriptor): void {
  entryFor(descriptor);
}

/** Source volontairement non branchée (clé absente, désactivée). */
export function markUnconfigured(descriptor: SourceDescriptor, reason: string | null = null): void {
  const entry = entryFor(descriptor);
  entry.status = "unconfigured";
  entry.lastError = reason ? cleanError(reason) : null;
}

const cleanError = (message: string) => redactSecrets(message.replace(/\s+/g, " ").trim()).slice(0, 240);

/** Enregistre le résultat d'une tentative d'interrogation. */
export function recordAttempt(descriptor: SourceDescriptor, outcome: AttemptOutcome): void {
  const entry = entryFor(descriptor);
  entry.lastAttemptAt = outcome.finishedAt;
  entry.latencyMs = outcome.ok && outcome.cached ? null : Math.max(0, outcome.finishedAt - outcome.startedAt);
  if (outcome.ok) {
    entry.lastSuccessAt = outcome.finishedAt;
    entry.itemCount = outcome.itemCount;
    if (outcome.newestDataAt !== undefined) entry.newestDataAt = outcome.newestDataAt;
    entry.lastError = outcome.warning ? cleanError(outcome.warning) : null;
    entry.status = outcome.warning ? "degraded" : "healthy";
  } else {
    entry.lastError = cleanError(outcome.error);
    // Sans précision, les éléments du dernier succès restent ceux servis (cache, base).
    entry.itemCount = outcome.servedItems ?? entry.itemCount;
    entry.status = entry.itemCount > 0 && entry.lastSuccessAt !== null ? "stale" : "unavailable";
  }
}

/** Date propre la plus récente d'une liste de dates ISO (ignorées si illisibles ou futures de plus d'un jour). */
export function newestDate(dates: Iterable<string | null | undefined>, now = Date.now()): string | null {
  let best = Number.NEGATIVE_INFINITY;
  for (const value of dates) {
    const time = value ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(time) && time <= now + 86_400_000 && time > best) best = time;
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
}

const iso = (time: number | null) => (time === null ? null : new Date(time).toISOString());

/** Vue normalisée d'une entrée, calculée à l'instant `now`. */
function snapshot(entry: Entry, now: number): SourceHealth {
  const { descriptor } = entry;
  let status: SourceHealthStatus = entry.status;
  const staleAfter = descriptor.staleAfterMs ?? null;
  if ((status === "healthy" || status === "degraded") && staleAfter && entry.lastSuccessAt !== null && now - entry.lastSuccessAt > staleAfter) status = "stale";
  const newest = entry.newestDataAt ? Date.parse(entry.newestDataAt) : Number.NaN;
  return {
    id: descriptor.id,
    kind: descriptor.kind,
    name: descriptor.name,
    category: descriptor.category,
    status,
    lastAttemptAt: iso(entry.lastAttemptAt),
    lastSuccessAt: iso(entry.lastSuccessAt),
    newestDataAt: entry.newestDataAt,
    dataAgeMs: Number.isFinite(newest) ? Math.max(0, now - newest) : null,
    latencyMs: entry.latencyMs,
    itemCount: entry.itemCount,
    lastError: entry.lastError,
    provenance: { homepage: descriptor.homepage ?? null, license: descriptor.license ?? null, nature: descriptor.nature ?? null },
    quota: descriptor.quota ?? null,
  };
}

export function getSourceHealth(id: string, now = Date.now()): SourceHealth | null {
  const entry = entries().get(id);
  return entry ? snapshot(entry, now) : null;
}

export function listSourceHealth(now = Date.now()): SourceHealth[] {
  return [...entries().values()].map((entry) => snapshot(entry, now)).sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

export function summarize(sources: SourceHealth[]): Record<SourceHealthStatus, number> {
  const summary = Object.fromEntries(SOURCE_HEALTH_STATUSES.map((status) => [status, 0])) as Record<SourceHealthStatus, number>;
  for (const source of sources) summary[source.status] += 1;
  return summary;
}

export function sourcesStatus(now = Date.now()): SourcesStatusResponse {
  const sources = listSourceHealth(now);
  return { generatedAt: new Date(now).toISOString(), summary: summarize(sources), sources };
}

/** Remise à zéro, réservée aux tests. */
export function resetSourceHealth(): void {
  entries().clear();
}
