import "server-only";
import { agentConfigured } from "@/server/agent";
import { rateLimitStore } from "@/server/aura/rateLimitStore";
import { healthInfo } from "@/server/intel";
// Imports pour leurs effets : chaque famille déclare ses sources dans le registre.
import "@/server/feeds";
import "@/server/layers";
import { listSourceHealth, sourcesStatus, summarize } from "./registry";

/**
 * Service de santé : agrège le registre des sources, l'état du stockage et d'AURA.
 * Lecture seule : aucun appel réseau, aucune ingestion déclenchée.
 */

export { sourcesStatus };

export function applicationHealth(now = Date.now()) {
  const sources = listSourceHealth(now);
  const summary = summarize(sources);
  const attempted = sources.filter((source) => source.status !== "pending" && source.status !== "unconfigured");
  const failing = attempted.filter((source) => source.status === "unavailable" || source.status === "stale").length;
  const store = rateLimitStore();
  const rateLimit = store.health();
  const intel = healthInfo();
  return {
    // Le processus répond : « ok ». Plus de la moitié des sources interrogées en échec : « degraded ».
    status: (attempted.length && failing * 2 > attempted.length) || (intel.schema?.integrity && intel.schema.integrity !== "ok") || rateLimit.status !== "healthy" ? "degraded" : "ok",
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
  } as const;
}
