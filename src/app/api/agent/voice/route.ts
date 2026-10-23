import { instrumentRoute } from "@/server/observability/http";
import { checkAuraAccess } from "@/server/aura/access";
import { admitVoiceRequest } from "@/server/aura/budget";
import { clientKey } from "@/server/aura/clientIdentity";
import { checkOrbitalOrigin, jsonResponse } from "@/server/aura/origin";
import { isJsonContentType, readBoundedText } from "@/server/aura/requestBody";
import { defaultVoice, synthesizeSpeech, VOICE_OPTIONS, voiceConfigured, voiceLimits, voiceModel } from "@/server/voice";
import { increment, observe } from "@/server/observability/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Voix d'AURA : synthèse neurale OpenAI (mp3) servie au client.
 *
 * GET  → configuration + liste des voix disponibles.
 * POST → { text, voice?, locale? } → audio/mpeg (une phrase ou deux par appel).
 *
 * Mêmes garde-fous que l'analyse : origine, accès facultatif, corps borné,
 * concurrence, débit par minute et budget journalier de caractères (la voix
 * consomme le crédit OpenAI). Caractères rendus au budget si l'audio n'est pas produit.
 */

export const GET = instrumentRoute("/api/agent/voice", GETHandler);
async function GETHandler() {
  return jsonResponse(
    {
      configured: voiceConfigured(),
      model: voiceModel(),
      defaultVoice: defaultVoice(),
      voices: VOICE_OPTIONS,
    },
    200,
  );
}

export const POST = instrumentRoute("/api/agent/voice", POSTHandler);
async function POSTHandler(request: Request) {
  const rejected = checkOrbitalOrigin(request) ?? checkAuraAccess(request);
  if (rejected) return rejected;

  const limits = voiceLimits();
  if (!isJsonContentType(request)) return jsonResponse({ error: "Content-Type application/json requis" }, 415);

  const body = await readBoundedText(request, limits.bodyBytes);
  if (!body.ok) return jsonResponse({ error: body.error }, body.status);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return jsonResponse({ error: "JSON invalide" }, 400);
  }
  if (!parsed || typeof parsed !== "object") return jsonResponse({ error: "objet JSON attendu" }, 400);

  const { text, voice, locale } = parsed as { text?: unknown; voice?: unknown; locale?: unknown };
  if (typeof text !== "string" || text.trim().length < 2) {
    return jsonResponse({ error: "texte à prononcer requis" }, 400);
  }
  if (text.length > limits.maxChars) {
    return jsonResponse({ error: `texte trop long (max ${limits.maxChars} caractères)` }, 413);
  }

  const admission = await admitVoiceRequest(clientKey(request), text.length, limits);
  if (!admission.ok) {
    increment("aura_admission_rejections_total", { mode: "voice", reason: admission.code });
    const headers: Record<string, string> = admission.retryAfter ? { "Retry-After": String(admission.retryAfter) } : {};
    return jsonResponse({ error: admission.error, code: admission.code }, admission.status, headers);
  }

  const started = performance.now();
  let recorded = false;
  const recordRun = (result: "success" | "error" | "aborted" | "timeout") => {
    if (recorded) return;
    recorded = true;
    increment("aura_runs_total", { mode: "voice", result });
    observe("aura_duration_seconds", { mode: "voice" }, (performance.now() - started) / 1000);
  };

  let result: Awaited<ReturnType<typeof synthesizeSpeech>>;
  try {
    result = await synthesizeSpeech({
      text,
      voice: typeof voice === "string" ? voice : undefined,
      locale: locale === "en" ? "en" : "fr",
      signal: request.signal,
    });
  } catch {
    result = { error: { code: "network", status: 502, message: "Service vocal OpenAI injoignable." } };
  }
  if ("error" in result) {
    await admission.refund();
    await admission.release();
    recordRun(request.signal.aborted ? "aborted" : "error");
    return jsonResponse({ error: result.error.message, code: result.error.code }, result.error.status);
  }

  // Le jeton de concurrence est rendu quand l'audio a fini de transiter (ou à l'annulation).
  const reader = result.body.getReader();
  const audio = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          await admission.release();
          recordRun("success");
        } else controller.enqueue(value);
      } catch {
        controller.error(new Error("flux vocal interrompu"));
        await admission.release();
        recordRun(request.signal.aborted ? "aborted" : "error");
      }
    },
    async cancel() {
      await reader.cancel().catch(() => undefined);
      await admission.release();
      recordRun("aborted");
    },
  });

  return new Response(audio, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
