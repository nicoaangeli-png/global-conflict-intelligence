import { instrumentRoute } from "@/server/observability/http";
import { agentConfigured, agentLimits, normalizeContext, runAgent, type AgentMessage, type AgentUsageFinal } from "@/server/agent";
import { checkAuraAccess } from "@/server/aura/access";
import { admitAgentRequest, requestFingerprint } from "@/server/aura/budget";
import { clientKey } from "@/server/aura/clientIdentity";
import { checkOrbitalOrigin, jsonResponse as json } from "@/server/aura/origin";
import { isJsonContentType, readBoundedText } from "@/server/aura/requestBody";
import { increment, observe } from "@/server/observability/metrics";
import { log } from "@/server/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Analyse AURA (NDJSON). Ordre des contrôles, chacun dans son module :
 * origine (navigateur) → accès (jeton facultatif) → format → corps borné →
 * validation → admission (budgets, débit, concurrence, doublons) → exécution.
 */

export const GET = instrumentRoute("/api/agent", GETHandler);
async function GETHandler() {
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

export const POST = instrumentRoute("/api/agent", POSTHandler);
async function POSTHandler(request: Request) {
  const rejected = checkOrbitalOrigin(request) ?? checkAuraAccess(request);
  if (rejected) return rejected;

  if (!isJsonContentType(request)) return json({ error: "Content-Type application/json requis" }, 415);

  const limits = agentLimits();
  const body = await readBoundedText(request, limits.bodyBytes);
  if (!body.ok) return json({ error: body.error }, body.status);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
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

  const normContext = normalizeContext(context);
  const admission = await admitAgentRequest(clientKey(request), requestFingerprint([cleanMessages, normContext]), limits);
  if (!admission.ok) {
    increment("aura_admission_rejections_total", { mode: "text", reason: admission.code });
    const headers: Record<string, string> = admission.retryAfter ? { "Retry-After": String(admission.retryAfter) } : {};
    return json({ error: admission.error, code: admission.code }, admission.status, headers);
  }

  // Déconnexion du client ou annulation du flux : l'appel OpenAI est interrompu.
  const abort = new AbortController();
  const onClientGone = () => abort.abort();
  if (request.signal.aborted) abort.abort();
  else request.signal.addEventListener("abort", onClientGone, { once: true });

  const encoder = new TextEncoder();
  let finished = false;
  let finalUsage: AgentUsageFinal = { kind: "unknown" };
  const started = performance.now();
  let result: "success" | "incomplete" | "error" | "aborted" | "timeout" = "error";
  let recorded = false;
  const recordRun = () => {
    if (recorded) return;
    recorded = true;
    increment("aura_runs_total", { mode: "text", result: abort.signal.aborted && result !== "success" ? "aborted" : result });
    observe("aura_duration_seconds", { mode: "text" }, (performance.now() - started) / 1000);
  };
  const finalizeAdmission = () => finalUsage.kind === "known"
    ? admission.completedWithUsage(finalUsage.tokens)
    : admission.failedWithUnknownUsage();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of runAgent(cleanMessages, normContext, {
          signal: abort.signal,
          onUsageFinal: (usage) => { finalUsage = usage; },
        })) {
          controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
          if (chunk.t === "done" || chunk.t === "incomplete" || chunk.t === "error") {
            finished = true;
            result = chunk.t === "done" ? "success" : chunk.t === "incomplete" ? "incomplete" : chunk.code === "deadline" || chunk.code === "idle_timeout" ? "timeout" : "error";
          }
        }
        if (!finished && !abort.signal.aborted) {
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
        // Jamais le message interne : il peut contenir des détails d'infrastructure.
        log("warn", "agent_stream_error", { subsystem: "aura" });
        if (!finished && !abort.signal.aborted) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ t: "error", text: "Erreur interne de l'agente.", code: "server_error" })}\n`));
        }
      } finally {
        request.signal.removeEventListener("abort", onClientGone);
        await finalizeAdmission();
        recordRun();
        try {
          controller.close();
        } catch {
          // Flux déjà annulé par le client.
        }
      }
    },
    async cancel() {
      abort.abort();
      await finalizeAdmission();
      recordRun();
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
