import "server-only";
import { SOURCE_HEALTH_STATUSES } from "@/types/health";
import { rateLimitHealth } from "@/server/aura/rateLimitStore";
import { readinessSnapshot } from "@/server/health/service";
import { listSourceHealth, summarize } from "@/server/health/registry";
import { publicApiHealth } from "@/server/publicApi/limits";
import { renderMetrics, sample } from "./metrics";

/** Vue instantanée locale : pas d'appel réseau, d'ingestion ni d'écriture PostgreSQL. */
export function exportMetrics(now = Date.now()): string {
  const lines = [renderMetrics().trimEnd()];
  const gauge = (name: string, description: string, rows: Array<[Record<string, string>, number]>) => {
    lines.push(`# HELP orbital_${name} ${description}`, `# TYPE orbital_${name} gauge`);
    for (const [labels, value] of rows) lines.push(sample(`orbital_${name}`, labels, value));
  };
  const mem = process.memoryUsage();
  gauge("process_uptime_seconds", "Uptime of this process in seconds.", [[{}, process.uptime()]]);
  gauge("process_resident_memory_bytes", "Resident memory of this process.", [[{}, mem.rss]]);
  gauge("process_heap_used_bytes", "Used JavaScript heap of this process.", [[{}, mem.heapUsed]]);
  gauge("process_heap_total_bytes", "Allocated JavaScript heap of this process.", [[{}, mem.heapTotal]]);
  const sources = listSourceHealth(now).filter((source) => /^(feed|connector|layer):[a-z0-9_-]{1,48}$/.test(source.id)).slice(0, 128);
  const counts = summarize(sources);
  gauge("sources_by_status", "Registered sources by current status.", SOURCE_HEALTH_STATUSES.map((status) => [{ status }, counts[status]]));
  gauge("source_last_success_age_seconds", "Age of the last successful collection.", sources.flatMap((source) => source.lastSuccessAt ? [[{ source: source.id }, Math.max(0, (now - Date.parse(source.lastSuccessAt)) / 1000)] as [Record<string, string>, number]] : []));
  gauge("source_items", "Last known item count for a source.", sources.map((source) => [{ source: source.id }, source.itemCount]));
  gauge("source_data_age_seconds", "Age of newest source data when known.", sources.flatMap((source) => source.dataAgeMs === null ? [] : [[{ source: source.id }, source.dataAgeMs / 1000] as [Record<string, string>, number]]));
  const publicApi = publicApiHealth();
  const limiter = rateLimitHealth();
  gauge("sse_active_connections", "Active SSE connections on this process.", [[{}, publicApi.sse.active]]);
  gauge("rate_limit_backend_status", "One-hot status of the configured rate limiter.", ["healthy", "degraded", "unavailable"].map((status) => [{ backend: limiter.backend, status }, Number(limiter.status === status)]));
  gauge("rate_limit_distributed", "One if the configured rate limiter is distributed.", [[{}, Number(limiter.distributed)]]);
  const readiness = readinessSnapshot();
  gauge("readiness", "Last known readiness of this process; zero before the first probe.", [[{}, Number(readiness.status === "ready")]]);
  return `${lines.join("\n")}\n`;
}
