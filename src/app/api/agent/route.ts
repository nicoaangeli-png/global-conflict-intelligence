import { agentConfigured, agentLimits, normalizeContext, runAgent, type AgentMessage } from "@/server/agent";
import { checkOrbitalOrigin } from "@/server/auraOrigin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Gate = {
  globalHits: number[];
  clientHits: Map<string, number[]>;
  inflight: number;
  inflightByClient: Map<string, number>;
  day: string;
  dayCount: number;
};

const holder = globalThis as unknown as { __orbitalAgentGate?: Gate };
const gate: Gate = (holder.__orbitalAgentGate ??= {
  globalHits: [],
  clientHits: new Map(),
  inflight: 0,
  inflightByClient: new Map(),
  day: "",
  dayCount: 0,
});

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("cf-connecting-ip") || "local";
}

function pruneHits(hits: number[], now: number, windowMs: number) {
  const threshold = now - windowMs;
  let firstValid = 0;
  while (firstValid < hits.length && hits[firstValid] < threshold) firstValid++;
  if (firstValid > 0) hits.splice(0, firstValid);
}

function enforceGate(clientId: string): { ok: true } | { ok: false; status: number; error: string; retryAfter?: number } {
  const limits = agentLimits();
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  if (gate.day !== today) {
    gate.day = today;
    gate.dayCount = 0;
    gate.globalHits = [];
    gate.clientHits.clear();
    gate.inflight = 0;
    gate.inflightByClient.clear();
  }

  if (gate.dayCount >= limits.dailyRequests) {
    return { ok: false, status: 429, error: "quota journalier AURA épuisé" };
  }

  if (gate.inflight >= limits.maxConcurrent) {
    return { ok: false, status: 503, error: "service d'analyse saturé, réessayez dans quelques instants", retryAfter: 2 };
  }

  const clientActive = gate.inflightByClient.get(clientId) ?? 0;
  if (clientActive >= limits.perClientConcurrent) {
    return { ok: false, status: 429, error: "une seule requête concurrente par client", retryAfter: 1 };
  }

  pruneHits(gate.globalHits, now, 60_000);
  if (gate.globalHits.length >= limits.globalPerMinute) {
    return { ok: false, status: 429, error: "limite globale par minute atteinte", retryAfter: 5 };
  }

  let clientBucket = gate.clientHits.get(clientId);
  if (!clientBucket) {
    clientBucket = [];
    gate.clientHits.set(clientId, clientBucket);
  }
  pruneHits(clientBucket, now, 60_000);
  if (clientBucket.length >= limits.perClientPerMinute) {
    return { ok: false, status: 429, error: "limite de requêtes par minute atteinte", retryAfter: 10 };
  }

  gate.dayCount++;
  gate.globalHits.push(now);
  clientBucket.push(now);
  gate.inflight++;
  gate.inflightByClient.set(clientId, clientActive + 1);

  return { ok: true };
}

function releaseGate(clientId: string) {
  gate.inflight = Math.max(0, gate.inflight - 1);
  const cur = gate.inflightByClient.get(clientId) ?? 1;
  if (cur <= 1) gate.inflightByClient.delete(clientId);
  else gate.inflightByClient.set(clientId, cur - 1);
}

export async function GET() {
  const limits = agentLimits();
  return json(
    {
      configured: agentConfigured(),
      limits: {
        maxMessages: limits.maxMessages,
        maxUserChars: limits.maxUserChars,
        perClientPerMinute: limits.perClientPerMinute,
      },
    },
    200,
  );
}

export async function POST(request: Request) {
  const rejected = checkOrbitalOrigin(request);
  if (rejected) return rejected;

  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return json({ error: "Content-Type application/json requis" }, 415);
  }

  const limits = agentLimits();
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limits.bodyBytes) {
    return json({ error: "corps trop volumineux" }, 413);
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return json({ error: "lecture du corps impossible" }, 400);
  }
  if (text.length > limits.bodyBytes) return json({ error: "corps trop volumineux" }, 413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ error: "JSON invalide" }, 400);
  }

  if (!parsed || typeof parsed !== "object") return json({ error: "objet JSON attendu" }, 400);
  const { messages, context } = parsed as { messages?: unknown; context?: unknown };

  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "messages requis (tableau non vide)" }, 400);
  }
  if (messages.length > limits.maxMessages) {
    return json({ error: `maximum ${limits.maxMessages} messages autorisés` }, 400);
  }

  let totalChars = 0;
  const cleanMessages: AgentMessage[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") return json({ error: "message invalide" }, 400);
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return json({ error: "rôle invalide (user ou assistant)" }, 400);
    if (typeof content !== "string" || !content.trim()) return json({ error: "contenu texte requis" }, 400);
    const maxChars = role === "user" ? limits.maxUserChars : limits.maxAssistantChars;
    if (content.length > maxChars) {
      return json({ error: `message trop long (max ${maxChars} caractères pour ${role})` }, 400);
    }
    totalChars += content.length;
    cleanMessages.push({ role, content });
  }

  if (cleanMessages[cleanMessages.length - 1].role !== "user") {
    return json({ error: "le dernier message doit provenir de l'utilisateur" }, 400);
  }
  if (totalChars > limits.maxTotalChars) {
    return json({ error: `historique trop long (max ${limits.maxTotalChars} caractères au total)` }, 400);
  }

  const clientId = clientKey(request);
  const gateResult = enforceGate(clientId);
  if (!gateResult.ok) {
    const headers: Record<string, string> = {};
    if (gateResult.retryAfter) headers["Retry-After"] = String(gateResult.retryAfter);
    return json({ error: gateResult.error }, gateResult.status, headers);
  }

  const normContext = normalizeContext(context);
  const encoder = new TextEncoder();
  let finished = false;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of runAgent(cleanMessages, normContext)) {
          controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
          if (chunk.t === "done" || chunk.t === "incomplete" || chunk.t === "error") {
            finished = true;
          }
        }
        if (!finished) {
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({
                t: "error",
                code: "no_terminal",
                text: "Flux terminé sans état final : réponse à considérer comme incomplète.",
              })}\n`,
            ),
          );
        }
      } catch (err) {
        if (!finished) {
          const message = err instanceof Error ? err.message : "Erreur interne de l'agente";
          controller.enqueue(encoder.encode(`${JSON.stringify({ t: "error", text: message, code: "server_error" })}\n`));
        }
      } finally {
        releaseGate(clientId);
        controller.close();
      }
    },
    cancel() {
      releaseGate(clientId);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
