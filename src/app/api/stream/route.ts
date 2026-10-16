import { ensureReady, subscribe } from "@/server/intel";

/**
 * GET /api/stream — flux temps réel (Server-Sent Events).
 *
 * Le serveur pousse uniquement des CHANGEMENTS : battement de cœur régulier,
 * et notification d'ingestion. Le client ne recharge jamais toute la base,
 * il réinterroge l'agrégat filtré à la demande.
 */
export async function GET(request: Request) {
  await ensureReady();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      send(`retry: 4000\n\n`);
      send(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

      const unsubscribe = subscribe(send);
      const heartbeat = setInterval(() => {
        send(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
      }, 12_000);

      const close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* déjà fermé */
        }
      };
      request.signal.addEventListener("abort", close);
    },
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
