import { agentConfigured, agentLimits, normalizeContext, runAgent, type AgentMessage } from "@/server/agent";

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

function configuredOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const entry of (process.env.AURA_ALLOWED_ORIGINS ?? "").split(",")) {
    try {
      if (entry.trim()) origins.add(new URL(entry.trim()).origin);
    } catch {
      continue;
    }
  }
  return origins;
}

function hostnameOf(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname.endsWith(".localhost") || /^\[.*\]$/.test(hostname) || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function checkOrigin(request: Request): Response | null {
  const allowed = configuredOrigins();
  const allowedHosts = new Set([...allowed].map((origin) => new URL(origin).host.toLowerCase()));
  const trustProxy = process.env.AURA_TRUST_PROXY === "1";
  const host = ((trustProxy ? request.headers.get("x-forwarded-host") : null) ?? request.headers.get("host") ?? "").toLowerCase();
  const hostname = hostnameOf(host);
  if (!host || !hostname || !(isLocalHostname(hostname) || allowedHosts.has(host))) {
    return json({ error: "hôte non autorisé" }, 403);
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return json({ error: "origine non autorisée" }, 403);

  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string;
    let originValue: string;
    try {
      const parsed = new URL(origin);
      originHost = parsed.host.toLowerCase();
      originValue = parsed.origin;
    } catch {
      return json({ error: "origine invalide" }, 403);
    }
    if (originHost !== host && !allowed.has(originValue)) return json({ error: "origine non autorisée" }, 403);
  } else if (fetchSite !== "same-origin") {
    return json({ error: "origine requise" }, 403);
  }

  if (request.headers.get("x-orbital-client") !== "aura") return json({ error: "client non autorisé" }, 403);
  return null;
}

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || request.headers.get("x-real-ip") || "local").slice(0, 64);
}

async function readBody(request: Request, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413, error: "corps trop volumineux" };
  if (!request.body) return { ok: false, status: 400, error: "corps manquant" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, error: "corps trop volumineux" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: "corps illisible" };
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

function acquire(client: string): { release: () => void } | Response {
  const limits = agentLimits();
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (gate.day !== today) {
    gate.day = today;
    gate.dayCount = 0;
  }
  while (gate.globalHits.length && gate.globalHits[0] < now - 60_000) gate.globalHits.shift();
  const hits = (gate.clientHits.get(client) ?? []).filter((at) => at > now - 60_000);
  for (const [key, list] of gate.clientHits) if (!list.length || list[list.length - 1] < now - 60_000) gate.clientHits.delete(key);

  if (gate.dayCount >= limits.dailyRequests) return json({ error: "Budget quotidien d'AURA atteint, réessaie demain." }, 429, { "Retry-After": "3600" });
  if (gate.globalHits.length >= limits.globalPerMinute || hits.length >= limits.perClientPerMinute) {
    return json({ error: "Trop de questions, patiente une minute." }, 429, { "Retry-After": "30" });
  }
  const clientInflight = gate.inflightByClient.get(client) ?? 0;
  if (gate.inflight >= limits.maxConcurrent || clientInflight >= limits.perClientConcurrent) {
    return json({ error: "Une analyse est déjà en cours, patiente quelques secondes." }, 429, { "Retry-After": "5" });
  }

  gate.globalHits.push(now);
  hits.push(now);
  gate.clientHits.set(client, hits);
  gate.dayCount += 1;
  gate.inflight += 1;
  gate.inflightByClient.set(client, clientInflight + 1);
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      gate.inflight = Math.max(0, gate.inflight - 1);
      const remaining = (gate.inflightByClient.get(client) ?? 1) - 1;
      if (remaining > 0) gate.inflightByClient.set(client, remaining);
      else gate.inflightByClient.delete(client);
    },
  };
}

export async function GET() {
  const limits = agentLimits();
  return json(
    { configured: agentConfigured(), limits: { maxMessages: limits.maxMessages, maxUserChars: limits.maxUserChars, maxAssistantChars: limits.maxAssistantChars, maxTotalChars: limits.maxTotalChars } },
    200,
  );
}

export async function POST(request: Request) {
  const limits = agentLimits();
  const rejected = checkOrigin(request);
  if (rejected) return rejected;

  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return json({ error: "Content-Type application/json requis" }, 415);

  const raw = await readBody(request, limits.bodyBytes);
  if (!raw.ok) return json({ error: raw.error }, raw.status);
  let body: { messages?: unknown; context?: unknown } | null;
  try {
    body = JSON.parse(raw.text) as { messages?: unknown; context?: unknown } | null;
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || !Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > limits.maxMessages) {
    return json({ error: "messages invalides" }, 400);
  }

  const messages: AgentMessage[] = [];
  let totalChars = 0;
  for (const entry of body.messages as { role?: unknown; content?: unknown }[]) {
    const maxChars = entry?.role === "assistant" ? limits.maxAssistantChars : limits.maxUserChars;
    if ((entry?.role !== "user" && entry?.role !== "assistant") || typeof entry.content !== "string") return json({ error: "message invalide" }, 400);
    const content = entry.content.replace(/\u0000/g, "").trim();
    if (!content || content.length > maxChars) return json({ error: "message invalide" }, 400);
    totalChars += content.length;
    messages.push({ role: entry.role, content });
  }
  if (totalChars > limits.maxTotalChars) return json({ error: "conversation trop longue" }, 413);
  if (messages[messages.length - 1].role !== "user") return json({ error: "la dernière entrée doit être une question" }, 400);

  const context = normalizeContext(body.context);
  const slot = acquire(clientKey(request));
  if (slot instanceof Response) return slot;

  const encoder = new TextEncoder();
  const cancellation = new AbortController();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
      };
      let terminalSent = false;
      const signal = AbortSignal.any([request.signal, cancellation.signal]);
      try {
        for await (const chunk of runAgent(messages, context, signal)) {
          if (chunk.t === "done" || chunk.t === "incomplete" || chunk.t === "error") terminalSent = true;
          send(chunk);
        }
        if (!terminalSent && !signal.aborted) send({ t: "error", code: "no_terminal", text: "Flux terminé sans état final : réponse à considérer comme incomplète." });
      } catch (error) {
        if (!signal.aborted) {
          console.warn("[agent] échec", error instanceof Error ? error.name : "unknown");
          if (!terminalSent) send({ t: "error", code: "server", text: "Service d'analyse indisponible." });
        }
      } finally {
        slot.release();
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      cancellation.abort();
      slot.release();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
