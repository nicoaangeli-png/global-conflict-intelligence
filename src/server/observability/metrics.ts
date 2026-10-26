import "server-only";

export const ROUTES = ["/api/events", "/api/latest", "/api/stats", "/api/feeds", "/api/cluster", "/api/briefing", "/api/coverage", "/api/country", "/api/layers", "/api/cameras", "/api/cameras/detail", "/api/cameras/frame", "/api/detection", "/api/stream", "/api/agent", "/api/agent/voice", "/api/ingest", "/api/health", "/api/health/live", "/api/health/ready", "/api/metrics", "/api/sources/status", "other"] as const;
export type Route = typeof ROUTES[number];
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "OTHER"];
const STATUSES = [200, 201, 202, 204, 206, 301, 302, 304, 307, 308, 400, 401, 403, 404, 405, 408, 409, 410, 413, 415, 422, 429, 499, 500, 502, 503, 504].map(String);
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];
const definitions = {
  http_requests_total: ["counter", ["route", "method", "status"]],
  http_duration_seconds: ["histogram", ["route", "method"]],
  http_in_flight: ["gauge", ["route", "method"]],
  public_api_rejections_total: ["counter", ["route", "reason"]],
  sse_events_total: ["counter", ["event"]],
  aura_runs_total: ["counter", ["mode", "result"]],
  aura_duration_seconds: ["histogram", ["mode"]],
  aura_admission_rejections_total: ["counter", ["mode", "reason"]],
  aura_tokens_total: ["counter", ["usage"]],
  source_attempts_total: ["counter", ["source", "result"]],
  source_duration_seconds: ["histogram", ["source"]],
  detection_signals_total: ["counter", ["result"]],
  detection_changes_total: ["counter", ["operation"]],
  detection_errors_total: ["counter", []],
  detection_duration_seconds: ["histogram", []],
} as const;
type Metric = keyof typeof definitions;
type Series = { labels: Record<string, string>; value: number; count: number; buckets: number[] };
type State = { series: Map<Metric, Map<string, Series>>; sources: Set<string> };
const holder = globalThis as unknown as { __orbitalObservability?: State };
const state = () => holder.__orbitalObservability ??= { series: new Map(), sources: new Set() };
const bounded: Record<string, readonly string[]> = {
  route: ROUTES, method: METHODS, status: [...STATUSES, "other"],
  mode: ["text", "voice"], usage: ["known", "reserved_unknown"],
  result: ["success", "error", "incomplete", "aborted", "timeout", "unknown", "cached", "accepted", "skipped"],
  operation: ["event_created", "signal_revised"],
  reason: ["quota", "backend", "saturated", "client_concurrency", "global_rate", "client_rate", "duplicate", "daily_quota", "daily_token_budget", "daily_budget", "rate", "rate_limit_config", "rate_limit_unavailable", "other"],
  event: ["accepted", "refused", "reconnect_attempt", "normal", "aborted", "backpressure", "expired", "error"],
};

export function normalizedRoute(route: string): Route { return (ROUTES as readonly string[]).includes(route) ? route as Route : "other"; }
export function normalizedMethod(method: string): string { return METHODS.includes(method) ? method : "OTHER"; }

/** Les IDs proviennent du registre serveur, jamais d'une URL client. Plafond dur de 128. */
export function registerMetricSource(source: string): void {
  try { if (/^(feed|connector|layer|camera):[a-z0-9_-]{1,48}$/.test(source) && state().sources.size < 128) state().sources.add(source); } catch { /* observation facultative */ }
}

function series(name: Metric, labels: Record<string, string>): Series | null {
  const expected = definitions[name][1];
  const clean: Record<string, string> = {};
  for (const key of expected) {
    const value = String(labels[key] ?? "other");
    clean[key] = key === "source" ? (state().sources.has(value) ? value : "other") : bounded[key]?.includes(value) ? value : "other";
  }
  const key = JSON.stringify(clean);
  let map = state().series.get(name);
  if (!map) state().series.set(name, map = new Map());
  let entry = map.get(key);
  if (!entry) {
    if (map.size >= 4096) return null;
    entry = { labels: clean, value: 0, count: 0, buckets: BUCKETS.map(() => 0) };
    map.set(key, entry);
  }
  return entry;
}

/** Toutes les primitives sont best-effort : aucune exception ne quitte l'observabilité. */
export function increment(name: Metric, labels: Record<string, string> = {}, value = 1): void {
  try {
    if (definitions[name][0] !== "counter" || !Number.isFinite(value) || value < 0) return;
    const entry = series(name, labels); if (entry) entry.value += value;
  } catch { /* métrique perdue, métier préservé */ }
}
export function inFlight(route: string, method: string, delta: 1 | -1): void {
  try { const entry = series("http_in_flight", { route, method }); if (entry) entry.value = Math.max(0, entry.value + delta); } catch { /* best-effort */ }
}
export function observe(name: Metric, labels: Record<string, string> = {}, seconds: number): void {
  try {
    if (definitions[name][0] !== "histogram" || !Number.isFinite(seconds) || seconds < 0) return;
    const entry = series(name, labels); if (!entry) return;
    entry.value += seconds; entry.count++;
    for (let i = 0; i < BUCKETS.length; i++) if (seconds <= BUCKETS[i]) entry.buckets[i]++;
  } catch { /* best-effort */ }
}
const escapeLabel = (value: string) => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
export function sample(name: string, labels: Record<string, string>, value: number): string {
  const pairs = Object.entries(labels).map(([key, val]) => `${key}="${escapeLabel(val)}"`).join(",");
  return `${name}${pairs ? `{${pairs}}` : ""} ${Number.isFinite(value) ? value : 0}`;
}
export function renderMetrics(): string {
  const lines: string[] = [];
  for (const [name, [kind]] of Object.entries(definitions)) {
    const full = `orbital_${name}`;
    lines.push(`# HELP ${full} ORBITAL per-process ${name.replace(/_/g, " ")}.`, `# TYPE ${full} ${kind}`);
    for (const entry of state().series.get(name as Metric)?.values() ?? []) {
      if (kind === "histogram") {
        BUCKETS.forEach((bound, index) => lines.push(sample(`${full}_bucket`, { ...entry.labels, le: String(bound) }, entry.buckets[index])));
        lines.push(sample(`${full}_bucket`, { ...entry.labels, le: "+Inf" }, entry.count), sample(`${full}_sum`, entry.labels, entry.value), sample(`${full}_count`, entry.labels, entry.count));
      } else lines.push(sample(full, entry.labels, entry.value));
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Réservé aux tests ; aucun historique de requêtes n'est conservé. */
export function resetMetrics(): void { holder.__orbitalObservability = { series: new Map(), sources: new Set() }; }
