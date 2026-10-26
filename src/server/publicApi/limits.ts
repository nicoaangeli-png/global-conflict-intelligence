import "server-only";
import { clientKey } from "@/server/aura/clientIdentity";
import { MINUTE_MS, minuteWindow, type RateLimitHealth } from "@/server/aura/rateLimit";
import { rateLimitHealth, rateLimitStore } from "@/server/aura/rateLimitStore";
import { increment } from "@/server/observability/metrics";

export type PublicRoute = "events" | "latest" | "stats" | "feeds" | "cluster" | "briefing" | "briefing-write" | "coverage" | "country" | "layers" | "detection" | "cameras" | "camera-frame";
const cost: Record<PublicRoute, number> = {
  events: 2, latest: 1, stats: 2, feeds: 2, cluster: 4,
  briefing: 2, "briefing-write": 1, coverage: 1, country: 2, layers: 2, detection: 2, cameras: 2, "camera-frame": 4,
};
const metrics = globalThis as unknown as { __orbitalPublicRejected?: number; __orbitalSseActive?: number; __orbitalSseRejected?: number };

function configuredPositive(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  return value;
}

function reject(route: PublicRoute, status: 429 | 503, retryAfter = 10): Response {
  increment("public_api_rejections_total", { route: route === "briefing-write" ? "/api/briefing" : `/api/${route}`, reason: status === 429 ? "quota" : "backend" });
  if (status === 429) metrics.__orbitalPublicRejected = (metrics.__orbitalPublicRejected ?? 0) + 1;
  return Response.json({ error: status === 429 ? "Trop de requêtes. Réessayez plus tard." : "Protection temporairement indisponible." }, {
    status, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) },
  });
}

/** Compteurs atomiques partagés par route et par client ; aucune IP brute n'est persistée. */
export async function guardPublicApi(request: Request, route: PublicRoute): Promise<Response | null> {
  try {
    const store = rateLimitStore();
    const now = Date.now();
    const window = minuteWindow(now);
    const ttlMs = (window + 1) * MINUTE_MS - now;
    const identity = clientKey(request);
    const units = cost[route];
    const globalLimit = route === "briefing-write"
      ? configuredPositive("ORBITAL_BRIEFING_WRITE_GLOBAL_PER_MINUTE", 4)
      : configuredPositive("ORBITAL_PUBLIC_API_GLOBAL_UNITS_PER_MINUTE", 3000);
    const clientLimit = route === "briefing-write"
      ? configuredPositive("ORBITAL_BRIEFING_WRITE_CLIENT_PER_MINUTE", 1)
      : configuredPositive("ORBITAL_PUBLIC_API_CLIENT_UNITS_PER_MINUTE", 180);
    const items = [
      { key: `public:${route}:global:${window}`, cost: units, limit: globalLimit, ttlMs },
      { key: `public:all:global:${window}`, cost: units, limit: configuredPositive("ORBITAL_PUBLIC_API_TOTAL_GLOBAL_UNITS_PER_MINUTE", 6000), ttlMs },
    ];
    // Le cooldown déjà présent dans briefing était local au processus.
    // Cette clé à durée glissante maintient sa portée globale entre instances.
    if (route === "briefing-write") items.push({ key: "public:briefing-write:cooldown", cost: 1, limit: 1, ttlMs: 600_000 });
    // Sans proxy déclaré, tous les visiteurs sont anonymes : la borne globale
    // protège toujours le serveur sans imposer un quota individuel fictif.
    if (identity !== "anonymous") items.push(
      { key: `public:${route}:${identity}:${window}`, cost: units, limit: clientLimit, ttlMs },
      { key: `public:all:${identity}:${window}`, cost: units, limit: configuredPositive("ORBITAL_PUBLIC_API_TOTAL_CLIENT_UNITS_PER_MINUTE", 300), ttlMs },
    );
    const result = await store.consumeMany(items, now);
    return result.ok ? null : reject(route, 429, Math.max(1, Math.ceil(result.retryAfterMs / 1000)));
  } catch {
    return reject(route, 503);
  }
}

export function publicApiHealth(): { rateLimit: RateLimitHealth; sse: { active: number; rejected: number }; rejected429: number } {
  return {
    rateLimit: rateLimitHealth(),
    sse: { active: metrics.__orbitalSseActive ?? 0, rejected: metrics.__orbitalSseRejected ?? 0 },
    rejected429: metrics.__orbitalPublicRejected ?? 0,
  };
}

export function sseMetrics() { return metrics; }
export function publicLimit(name: string, fallback: number) { return configuredPositive(name, fallback); }
