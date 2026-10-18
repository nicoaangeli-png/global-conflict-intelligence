import { checkOrbitalOrigin, jsonResponse } from "@/server/auraOrigin";
import { defaultVoice, synthesizeSpeech, VOICE_OPTIONS, voiceConfigured, voiceLimits, voiceModel } from "@/server/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Voix d'AURA : synthèse neurale OpenAI (mp3) servie au client.
 *
 * GET  → configuration + liste des voix disponibles.
 * POST → { text, voice?, locale? } → audio/mpeg (une phrase ou deux par appel).
 *
 * Garde-fous : origine contrôlée, texte borné, débit limité par minute et
 * budget de caractères par jour (la voix consomme le crédit OpenAI).
 */

type Budget = { day: string; chars: number; hits: number[] };

const holder = globalThis as unknown as { __orbitalVoiceBudget?: Budget };
const budget: Budget = (holder.__orbitalVoiceBudget ??= { day: "", chars: 0, hits: [] });

function resetBudgetIfNeeded(today: string) {
  if (budget.day !== today) {
    budget.day = today;
    budget.chars = 0;
    budget.hits = [];
  }
}

function pruneHits(hits: number[], now: number, windowMs: number) {
  const threshold = now - windowMs;
  let firstValid = 0;
  while (firstValid < hits.length && hits[firstValid] < threshold) firstValid++;
  if (firstValid > 0) hits.splice(0, firstValid);
}

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("cf-connecting-ip") || "local";
}

const clientHits = new Map<string, number[]>();

export async function GET() {
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

export async function POST(request: Request) {
  const rejected = checkOrbitalOrigin(request);
  if (rejected) return rejected;

  const limits = voiceLimits();
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return jsonResponse({ error: "Content-Type application/json requis" }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limits.bodyBytes) {
    return jsonResponse({ error: "corps trop volumineux" }, 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await request.text());
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

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  resetBudgetIfNeeded(today);

  if (budget.chars + text.length > limits.maxCharsPerDay) {
    return jsonResponse(
      { error: "budget vocal journalier atteint : la voix du navigateur reste disponible", code: "daily_budget" },
      429,
    );
  }

  pruneHits(budget.hits, now, 60_000);
  if (budget.hits.length >= limits.perMinute) {
    return jsonResponse({ error: "trop de segments vocaux par minute", code: "rate" }, 429, { "Retry-After": "5" });
  }

  const client = clientKey(request);
  let bucket = clientHits.get(client);
  if (!bucket) {
    bucket = [];
    clientHits.set(client, bucket);
  }
  pruneHits(bucket, now, 60_000);
  if (bucket.length >= limits.perMinute) {
    return jsonResponse({ error: "trop de segments vocaux par minute", code: "rate" }, 429, { "Retry-After": "5" });
  }

  const result = await synthesizeSpeech({
    text,
    voice: typeof voice === "string" ? voice : undefined,
    locale: locale === "en" ? "en" : "fr",
  });
  if ("error" in result) {
    return jsonResponse({ error: result.error.message, code: result.error.code }, result.error.status);
  }

  budget.chars += text.length;
  budget.hits.push(now);
  bucket.push(now);

  return new Response(result.body, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
