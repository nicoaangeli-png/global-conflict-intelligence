import "server-only";
import { agentConfigured } from "@/server/agent";
import { rateLimitHealth, rateLimitStore } from "@/server/aura/rateLimitStore";
import { healthInfo, probeStorage } from "@/server/intel";
import { publicApiHealth } from "@/server/publicApi/limits";
// Imports pour leurs effets : chaque famille déclare ses sources dans le registre.
import "@/server/feeds";
import "@/server/layers";
import "@/server/cameras";
import { listSourceHealth, sourcesStatus, summarize } from "./registry";
import { log } from "@/server/observability/logger";

/**
 * Service de santé : agrège le registre des sources, l'état du stockage et d'AURA.
 * Lecture seule : aucun appel réseau, aucune ingestion déclenchée.
 */

export { sourcesStatus };

export type Readiness = { status: "ready" | "not_ready" | "unknown"; storage: boolean | null; rateLimit: boolean | null; checkedAt: string | null };
const holder = globalThis as unknown as { __orbitalReadiness?: { value: Readiness; at: number; pending?: Promise<Readiness> } };
const state = () => holder.__orbitalReadiness ??= { value: { status: "unknown", storage: null, rateLimit: null, checkedAt: null }, at: 0 };
export function readinessSnapshot(): Readiness {
  const entry = state();
  return entry.at && Date.now() - entry.at > 15_000 ? { ...entry.value, status: "unknown", storage: null, rateLimit: null } : entry.value;
}
function boundedProbe(pending: Promise<Readiness>, current: Readiness): Promise<Readiness> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<Readiness>((resolve) => { timer = setTimeout(() => resolve({ ...current, status: "not_ready" }), 2000); });
  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
}

/** Sonde coalescée ; aucune collecte externe ni ingestion. Le stockage est interrogé une fois. */
export async function checkReadiness(): Promise<Readiness> {
  const entry = state();
  if (entry.pending) return boundedProbe(entry.pending, entry.value);
  if (entry.at && Date.now() - entry.at < 5000) return entry.value;
  entry.pending = (async () => {
    const [storage, rateLimit] = await Promise.all([
      probeStorage(),
      rateLimitStore().peek("orbital:readiness", Date.now()).then(() => true, () => false),
    ]);
    const value: Readiness = { status: storage && rateLimit ? "ready" : "not_ready", storage, rateLimit, checkedAt: new Date().toISOString() };
    entry.value = value; entry.at = Date.now();
    if (value.status !== "ready") log("warn", "readiness_failed", { subsystem: "health" });
    return value;
  })().catch(() => {
    const value: Readiness = { status: "not_ready", storage: false, rateLimit: false, checkedAt: new Date().toISOString() };
    entry.value = value; entry.at = Date.now();
    return value;
  }).finally(() => { entry.pending = undefined; });
  return boundedProbe(entry.pending, entry.value);
}

export function resetReadiness(): void { delete holder.__orbitalReadiness; }

export function applicationHealth(now = Date.now()) {
  const sources = listSourceHealth(now);
  const summary = summarize(sources);
  const attempted = sources.filter((source) => source.status !== "pending" && source.status !== "unconfigured");
  const failing = attempted.filter((source) => source.status === "unavailable" || source.status === "stale").length;
  const rateLimit = rateLimitHealth();
  const intel = healthInfo();
  return {
    // Le processus répond : « ok ». Plus de la moitié des sources interrogées en échec : « degraded ».
    status: (attempted.length && failing * 2 > attempted.length) || (intel.schema?.integrity && intel.schema.integrity !== "ok") || rateLimit.status !== "healthy" || readinessSnapshot().status === "not_ready" ? "degraded" : "ok",
    generatedAt: new Date(now).toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    storage: {
      kind: intel.repository,
      lastIngestAt: intel.lastIngestAt,
      schemaVersion: intel.schema?.schemaVersion ?? null,
      integrity: intel.schema?.integrity ?? null,
    },
    sources: summary,
    aura: { configured: agentConfigured(), rateLimit },
    publicApi: publicApiHealth(),
    liveness: { status: "alive" as const },
    readiness: readinessSnapshot(),
  } as const;
}
