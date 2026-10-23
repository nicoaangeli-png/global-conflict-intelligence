import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { redactSecrets } from "@/server/security/redact";
import { normalizedMethod, normalizedRoute } from "./metrics";

type Context = { requestId: string; route: string; method: string };
const holder = globalThis as unknown as { __orbitalRequestContext?: AsyncLocalStorage<Context> };
export const requestContext = holder.__orbitalRequestContext ??= new AsyncLocalStorage<Context>();
const events = ["http_completed", "http_failed", "agent_stream_error", "agent_upstream_error", "agent_failed", "voice_upstream_error", "rate_limit_backend_error", "lease_release_deferred", "sweep_deferred", "memory_backend_explicit", "origin_configuration", "storage_fallback", "ingest_completed", "ingest_failed", "sqlite_integrity_error", "sqlite_checkpoint_failed", "detection_failed", "readiness_failed", "observability_error"] as const;
type Event = typeof events[number];
type Level = "debug" | "info" | "warn" | "error";
const levels: Level[] = ["debug", "info", "warn", "error"];
const subsystems = ["http", "aura", "voice", "rate_limit", "storage", "ingest", "detection", "health", "observability"];
const codes = ["network", "aborted", "deadline", "idle_timeout", "tool_timeout", "interrupted", "protocol", "rate_limit_config", "rate_limit_unavailable", "saturated", "server_error", "other"];
type Fields = { subsystem?: string; status?: number; durationMs?: number; errorCode?: string };

/** Champs en allowlist uniquement : pas de message libre, erreur brute, header ou corps. */
export function log(level: Level, event: Event, fields: Fields = {}): void {
  try {
    const configured = process.env.ORBITAL_LOG_LEVEL ?? "info";
    const threshold = levels.includes(configured as Level) ? configured as Level : "info";
    if (levels.indexOf(level) < levels.indexOf(threshold)) return;
    const context = requestContext.getStore();
    const record = {
      timestamp: new Date().toISOString(), level: levels.includes(level) ? level : "error",
      event: (events as readonly string[]).includes(event) ? event : "observability_error",
      subsystem: subsystems.includes(fields.subsystem ?? "") ? fields.subsystem : "observability",
      ...(context ? { requestId: /^[a-f0-9-]{36}$/.test(context.requestId) ? context.requestId : undefined, route: normalizedRoute(context.route), method: normalizedMethod(context.method) } : {}),
      ...(Number.isInteger(fields.status) && fields.status! >= 100 && fields.status! <= 599 ? { status: fields.status } : {}),
      ...(Number.isFinite(fields.durationMs) && fields.durationMs! >= 0 ? { durationMs: Math.round(fields.durationMs! * 100) / 100 } : {}),
      ...(fields.errorCode ? { errorCode: codes.includes(fields.errorCode) ? fields.errorCode : "other" } : {}),
    };
    const line = redactSecrets(JSON.stringify(record));
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } catch { /* Un sink de logs en panne ne fait jamais échouer le métier. */ }
}
