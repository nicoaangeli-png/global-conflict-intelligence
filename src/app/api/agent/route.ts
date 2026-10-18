import { agentConfigured, runAgent, type AgentContext, type AgentMessage } from "@/server/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Limite simple : 20 questions par minute pour toute l'instance. */
const gate = globalThis as unknown as { __orbitalAgentHits?: number[] };
const hits = (gate.__orbitalAgentHits ??= []);

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function GET() {
  return json({ configured: agentConfigured() }, 200);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { messages?: unknown; context?: unknown } | null;
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 24) {
    return json({ error: "messages invalides" }, 400);
  }
  const messages: AgentMessage[] = [];
  for (const m of body.messages as { role?: unknown; content?: unknown }[]) {
    if ((m?.role !== "user" && m?.role !== "assistant") || typeof m.content !== "string" || !m.content.trim() || m.content.length > 6000) {
      return json({ error: "message invalide" }, 400);
    }
    messages.push({ role: m.role, content: m.content.trim() });
  }
  if (messages[messages.length - 1].role !== "user") return json({ error: "la dernière entrée doit être une question" }, 400);

  const raw = (body.context && typeof body.context === "object" ? body.context : {}) as Record<string, unknown>;
  const str = (value: unknown, max = 120) => (typeof value === "string" ? value.slice(0, max) : undefined);
  const country = raw.country as Record<string, unknown> | null | undefined;
  const cluster = raw.cluster as Record<string, unknown> | null | undefined;
  const context: AgentContext = {
    locale: raw.locale === "en" ? "en" : "fr",
    range: str(raw.range, 8),
    country: country && typeof country === "object" && str(country.name) ? { name: str(country.name)!, iso: str(country.iso, 3) } : null,
    cluster: cluster && typeof cluster === "object"
      ? {
          locality: str(cluster.locality),
          country: str(cluster.country),
          eventCount: typeof cluster.eventCount === "number" ? cluster.eventCount : undefined,
        }
      : null,
  };

  const now = Date.now();
  while (hits.length && hits[0] < now - 60_000) hits.shift();
  if (hits.length >= 20) return json({ error: "Trop de questions, patiente une minute." }, 429);
  hits.push(now);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
      try {
        for await (const chunk of runAgent(messages, context, request.signal)) send(chunk);
      } catch (error) {
        if (!request.signal.aborted) {
          console.warn("[agent] échec", error instanceof Error ? error.message : error);
          send({ t: "error", text: "Service d'analyse indisponible." });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
