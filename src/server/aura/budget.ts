import "server-only";
import { createHash } from "node:crypto";
import { MINUTE_MS, minuteWindow, rateLimitStore, utcDay, type RateLimitStore } from "./rateLimit";

/**
 * Admission des requêtes payantes d'AURA (analyse OpenAI et voix), séparée du
 * contrôle d'origine et de l'authentification.
 *
 * Analyse : budget journalier de requêtes et de tokens, concurrence globale et par
 * client, débit par minute global et par client, refus des doublons rapprochés.
 * Voix : budget journalier de caractères, concurrence et débit par minute.
 * Les compteurs vivent dans le `RateLimitStore` (mémoire par défaut, non distribué).
 */

export type Rejection = { ok: false; status: 429 | 503; code: string; error: string; retryAfter?: number };
export type Admission = { ok: true; release: () => Promise<void> } | Rejection;

function bounded(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.floor(parsed) : fallback;
}

export type AgentAdmissionLimits = {
  maxConcurrent: number;
  perClientConcurrent: number;
  perClientPerMinute: number;
  globalPerMinute: number;
  dailyRequests: number;
};

/** Budgets de tokens OpenAI (entrée + sortie, d'après `usage` des réponses). */
export function tokenLimits() {
  return {
    dailyTokens: bounded("AURA_DAILY_TOKEN_BUDGET", 2_000_000, 10_000, 100_000_000),
    perRequestTokens: bounded("AURA_MAX_TOKENS_PER_REQUEST", 80_000, 5_000, 1_000_000),
    duplicateWindowMs: bounded("AURA_DUPLICATE_WINDOW_MS", 10_000, 0, 600_000),
  };
}

const retrySeconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/** Empreinte d'une requête (pour refuser un envoi identique répété). */
export function requestFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 22);
}

/** Libère une seule fois, quel que soit le nombre d'appels (fin du flux + annulation). */
function once(work: () => Promise<void>): () => Promise<void> {
  let done = false;
  return async () => {
    if (done) return;
    done = true;
    await work();
  };
}

export async function admitAgentRequest(
  client: string,
  fingerprint: string,
  limits: AgentAdmissionLimits,
  store: RateLimitStore = rateLimitStore(),
  now = Date.now(),
): Promise<Admission> {
  const { day, remainingMs } = utcDay(now);
  const tokens = tokenLimits();

  if ((await store.peek(`aura:tokens:${day}`, now)) >= tokens.dailyTokens) {
    return { ok: false, status: 429, code: "daily_token_budget", error: "budget journalier de tokens AURA épuisé", retryAfter: retrySeconds(remainingMs) };
  }
  if ((await store.peek(`aura:requests:${day}`, now)) >= limits.dailyRequests) {
    return { ok: false, status: 429, code: "daily_quota", error: "quota journalier AURA épuisé", retryAfter: retrySeconds(remainingMs) };
  }

  if (!(await store.acquire("aura:inflight", limits.maxConcurrent))) {
    return { ok: false, status: 503, code: "saturated", error: "service d'analyse saturé, réessayez dans quelques instants", retryAfter: 2 };
  }
  if (!(await store.acquire(`aura:inflight:${client}`, limits.perClientConcurrent))) {
    await store.release("aura:inflight");
    return { ok: false, status: 429, code: "client_concurrency", error: "une seule requête concurrente par client", retryAfter: 1 };
  }
  const release = once(async () => {
    await store.release(`aura:inflight:${client}`);
    await store.release("aura:inflight");
  });

  const minute = minuteWindow(now);
  const checks: [string, number, string, string][] = [
    [`aura:minute:${minute}`, limits.globalPerMinute, "global_rate", "limite globale par minute atteinte"],
    [`aura:minute:${minute}:${client}`, limits.perClientPerMinute, "client_rate", "limite de requêtes par minute atteinte"],
  ];
  for (const [key, limit, code, error] of checks) {
    const result = await store.consume(key, 1, limit, MINUTE_MS, now);
    if (!result.ok) {
      await release();
      return { ok: false, status: 429, code, error, retryAfter: retrySeconds(result.retryAfterMs) };
    }
  }

  if (tokens.duplicateWindowMs > 0) {
    const duplicate = await store.consume(`aura:dup:${client}:${fingerprint}`, 1, 1, tokens.duplicateWindowMs, now);
    if (!duplicate.ok) {
      await release();
      return { ok: false, status: 429, code: "duplicate", error: "requête identique déjà reçue, patientez avant de la renvoyer", retryAfter: retrySeconds(duplicate.retryAfterMs) };
    }
  }

  const daily = await store.consume(`aura:requests:${day}`, 1, limits.dailyRequests, remainingMs, now);
  if (!daily.ok) {
    await release();
    return { ok: false, status: 429, code: "daily_quota", error: "quota journalier AURA épuisé", retryAfter: retrySeconds(remainingMs) };
  }
  return { ok: true, release };
}

/** Enregistre les tokens consommés (cumul journalier, partagé par toutes les requêtes). */
export async function recordAgentTokens(tokens: number, store: RateLimitStore = rateLimitStore(), now = Date.now()) {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  const { day, remainingMs } = utcDay(now);
  await store.consume(`aura:tokens:${day}`, Math.ceil(tokens), Number.POSITIVE_INFINITY, remainingMs, now);
}

export type VoiceAdmissionLimits = { perMinute: number; maxCharsPerDay: number };

export function voiceConcurrency() {
  return {
    maxConcurrent: bounded("AURA_TTS_MAX_CONCURRENT", 4, 1, 32),
    perClientConcurrent: bounded("AURA_TTS_CLIENT_CONCURRENT", 2, 1, 8),
  };
}

/**
 * Admission d'un segment vocal. Les caractères sont réservés à l'admission ;
 * `refund` les rend si OpenAI n'a pas produit l'audio (aucun coût engagé).
 */
export async function admitVoiceRequest(
  client: string,
  chars: number,
  limits: VoiceAdmissionLimits,
  store: RateLimitStore = rateLimitStore(),
  now = Date.now(),
): Promise<(Admission & { ok: true; refund: () => Promise<void> }) | Rejection> {
  const { day, remainingMs } = utcDay(now);
  const concurrency = voiceConcurrency();

  if (!(await store.acquire("voice:inflight", concurrency.maxConcurrent))) {
    return { ok: false, status: 503, code: "saturated", error: "synthèse vocale saturée", retryAfter: 2 };
  }
  if (!(await store.acquire(`voice:inflight:${client}`, concurrency.perClientConcurrent))) {
    await store.release("voice:inflight");
    return { ok: false, status: 429, code: "client_concurrency", error: "trop de segments vocaux simultanés", retryAfter: 1 };
  }
  const release = once(async () => {
    await store.release(`voice:inflight:${client}`);
    await store.release("voice:inflight");
  });

  const minute = minuteWindow(now);
  for (const key of [`voice:minute:${minute}`, `voice:minute:${minute}:${client}`]) {
    const result = await store.consume(key, 1, limits.perMinute, MINUTE_MS, now);
    if (!result.ok) {
      await release();
      return { ok: false, status: 429, code: "rate", error: "trop de segments vocaux par minute", retryAfter: retrySeconds(result.retryAfterMs) };
    }
  }

  const charsKey = `voice:chars:${day}`;
  const reserved = await store.consume(charsKey, chars, limits.maxCharsPerDay, remainingMs, now);
  if (!reserved.ok) {
    await release();
    return { ok: false, status: 429, code: "daily_budget", error: "budget vocal journalier atteint : la voix du navigateur reste disponible" };
  }
  const refund = once(async () => {
    await store.consume(charsKey, -chars, Number.POSITIVE_INFINITY, remainingMs);
  });
  return { ok: true, release, refund };
}
