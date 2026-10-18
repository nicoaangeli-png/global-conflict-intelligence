import { ensureReady, subscribe } from "@/server/intel";

const streamState = globalThis as unknown as { __orbitalStreamConnections?: number };
const MAX_CONNECTIONS = 64;

/**
 * GET /api/stream — flux temps réel (Server-Sent Events).
 *
 * Le serveur pousse uniquement des CHANGEMENTS : battement de cœur régulier,
 * et notification d'ingestion. Le client ne recharge jamais toute la base,
 * il réinterroge l'agrégat filtré à la demande.
 */
export async function GET(request: Request) {
  if (request.signal.aborted) return new Response(null, { status: 408 });
  try {
    await ensureReady();
  } catch {
    return Response.json({ error: "Flux temporairement indisponible." }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "10" },
    });
  }
  if (request.signal.aborted) return new Response(null, { status: 408 });
  if ((streamState.__orbitalStreamConnections ?? 0) >= MAX_CONNECTIONS) {
    return Response.json({ error: "Capacité du flux atteinte." }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "10" },
    });
  }
  streamState.__orbitalStreamConnections = (streamState.__orbitalStreamConnections ?? 0) + 1;
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      let heartbeat: ReturnType<typeof setInterval>;
      let lifetime: ReturnType<typeof setTimeout>;
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        unsubscribe();
        request.signal.removeEventListener("abort", cleanup);
        streamState.__orbitalStreamConnections = Math.max(0, (streamState.__orbitalStreamConnections ?? 1) - 1);
        try {
          controller.close();
        } catch {}
      };
      const send = (chunk: string) => {
        if (closed) return;
        if ((controller.desiredSize ?? 0) < -16) {
          cleanup();
          return;
        }
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      unsubscribe = subscribe(send);
      heartbeat = setInterval(() => {
        send(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
      }, 12_000);
      lifetime = setTimeout(() => cleanup(), 300_000);
      request.signal.addEventListener("abort", cleanup, { once: true });
      if (request.signal.aborted) {
        cleanup();
        return;
      }
      send(`retry: 4000\n\n`);
      send(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    },
    cancel() { cleanup(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
