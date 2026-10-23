import { instrumentRoute } from "@/server/observability/http";
import { clientKey } from "@/server/aura/clientIdentity";
import { MINUTE_MS, minuteWindow } from "@/server/aura/rateLimit";
import { rateLimitStore } from "@/server/aura/rateLimitStore";
import { ensureReady, subscribe } from "@/server/intel";
import { publicLimit, sseMetrics } from "@/server/publicApi/limits";
import { increment } from "@/server/observability/metrics";

const HEARTBEAT_MS = 12_000;
const MAX_LIFETIME_MS = 300_000;
const LEASE_TTL_MS = MAX_LIFETIME_MS + 15_000;

function unavailable(status: 429 | 503, message: string) {
  increment("sse_events_total", { event: "refused" });
  increment("public_api_rejections_total", { route: "/api/stream", reason: status === 429 ? "quota" : "backend" });
  const metrics = sseMetrics();
  metrics.__orbitalSseRejected = (metrics.__orbitalSseRejected ?? 0) + 1;
  return Response.json({ error: message }, {
    status, headers: { "Cache-Control": "no-store", "Retry-After": "10" },
  });
}

/** Une lease globale et une lease client sont relâchées à toute fin de flux. */
export const GET = instrumentRoute("/api/stream", GETHandler);
async function GETHandler(request: Request) {
  increment("sse_events_total", { event: "reconnect_attempt" });
  if (request.signal.aborted) return new Response(null, { status: 408 });
  const store = rateLimitStore();
  const held: string[] = [];
  const release = async () => {
    const results = await Promise.allSettled(held.splice(0).map((id) => store.release(id)));
    if (results.some((result) => result.status === "rejected")) increment("sse_events_total", { event: "error" });
  };
  try {
    const now = Date.now();
    const window = minuteWindow(now);
    const identity = clientKey(request);
    const burst = await store.consumeMany([
      { key: `sse:reconnect:global:${window}`, cost: 1, limit: publicLimit("ORBITAL_SSE_GLOBAL_RECONNECTS_PER_MINUTE", 600), ttlMs: (window + 1) * MINUTE_MS - now },
      ...(identity === "anonymous" ? [] : [{ key: `sse:reconnect:${identity}:${window}`, cost: 1, limit: publicLimit("ORBITAL_SSE_CLIENT_RECONNECTS_PER_MINUTE", 30), ttlMs: (window + 1) * MINUTE_MS - now }]),
    ], now);
    if (!burst.ok) return unavailable(429, "Reconnexions trop fréquentes.");
    const global = await store.acquire("sse:active:global", publicLimit("ORBITAL_SSE_MAX_CONNECTIONS", 64), LEASE_TTL_MS);
    if (!global) return unavailable(429, "Capacité du flux atteinte.");
    held.push(global);
    if (identity !== "anonymous") {
      const client = await store.acquire(`sse:active:${identity}`, publicLimit("ORBITAL_SSE_MAX_PER_CLIENT", 3), LEASE_TTL_MS);
      if (!client) { await release(); return unavailable(429, "Trop de flux pour ce client."); }
      held.push(client);
    }
    if (request.signal.aborted) { await release(); return new Response(null, { status: 408 }); }
    await ensureReady();
    if (request.signal.aborted) { await release(); return new Response(null, { status: 408 }); }
  } catch {
    await release();
    return unavailable(503, "Flux temporairement indisponible.");
  }

  const metrics = sseMetrics();
  metrics.__orbitalSseActive = (metrics.__orbitalSseActive ?? 0) + 1;
  increment("sse_events_total", { event: "accepted" });
  const encoder = new TextEncoder();
  let cleanup = async (_reason = "normal") => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      let heartbeat: ReturnType<typeof setInterval>;
      let lifetime: ReturnType<typeof setTimeout>;
      cleanup = async (reason = "normal") => {
        if (closed) return;
        closed = true;
        increment("sse_events_total", { event: reason });
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe();
        request.signal.removeEventListener("abort", onAbort);
        metrics.__orbitalSseActive = Math.max(0, (metrics.__orbitalSseActive ?? 1) - 1);
        try { controller.close(); } catch { /* déjà annulé */ }
        await release();
      };
      const onAbort = () => { void cleanup("aborted"); };
      const send = (chunk: string) => {
        if (closed) return;
        // Le flux ne garde jamais plus de quatre messages en attente ; le client
        // lent se reconnectera et rechargera l'état courant plutôt que le backlog.
        if (chunk.length > 32_768 || (controller.desiredSize ?? 0) <= 0) { void cleanup("backpressure"); return; }
        try { controller.enqueue(encoder.encode(chunk)); } catch { void cleanup("error"); }
      };
      unsubscribe = subscribe(send);
      heartbeat = setInterval(() => send(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`), HEARTBEAT_MS);
      lifetime = setTimeout(() => { void cleanup("expired"); }, MAX_LIFETIME_MS);
      request.signal.addEventListener("abort", onAbort, { once: true });
      if (request.signal.aborted) { void cleanup("aborted"); return; }
      send("retry: 4000\n\n");
      send(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    },
    cancel() { return cleanup(); },
  }, { highWaterMark: 4, size: () => 1 });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
