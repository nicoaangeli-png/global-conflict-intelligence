import "server-only";
import { increment } from "@/server/observability/metrics";
import { log } from "@/server/observability/logger";
import { createHash } from "node:crypto";
import { MINUTE_MS, RateLimitBackendError, minuteWindow, utcDay, type Consumption, type RateLimitStore } from "./rateLimit";
import { rateLimitStore } from "./rateLimitStore";

export type Rejection = { ok: false; status: 429 | 503; code: string; error: string; retryAfter?: number };
export type Admission = {
  ok: true;
  /** Rapproche une seule fois la réservation avec un usage OpenAI final fiable. */
  completedWithUsage: (actualTokens: number) => Promise<void>;
  /** Conserve la réservation quand OpenAI n'a pas fourni d'usage final fiable. */
  failedWithUnknownUsage: () => Promise<void>;
} | Rejection;

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
  deadlineMs?: number;
};

export function tokenLimits() {
  return {
    dailyTokens: bounded("AURA_DAILY_TOKEN_BUDGET", 2_000_000, 10_000, 100_000_000),
    perRequestTokens: bounded("AURA_MAX_TOKENS_PER_REQUEST", 80_000, 5_000, 1_000_000),
    duplicateWindowMs: bounded("AURA_DUPLICATE_WINDOW_MS", 10_000, 0, 600_000),
  };
}

const retrySeconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));
const agentLeaseTtl = (limits: AgentAdmissionLimits) => Math.max(30_000, (limits.deadlineMs ?? 90_000) + 30_000);
const voiceLeaseTtl = () => bounded("AURA_TTS_LEASE_TTL_MS", 90_000, 50_000, 600_000);

/** Empreinte SHA-256 tronquée ; le prompt n'est jamais confié au store. */
export function requestFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 22);
}

function once(work: () => Promise<void>): () => Promise<void> {
  let done = false;
  return async () => {
    if (done) return;
    done = true;
    await work();
  };
}

function backendFailure(error: unknown): Rejection {
  const configuration = error instanceof RateLimitBackendError && error.code === "rate_limit_config";
  log("warn", "rate_limit_backend_error", { subsystem: "rate_limit", errorCode: configuration ? "rate_limit_config" : "rate_limit_unavailable" });
  return {
    ok: false,
    status: 503,
    code: configuration ? "rate_limit_config" : "rate_limit_unavailable",
    error: configuration
      ? "protection de débit AURA mal configurée"
      : "protection de débit AURA temporairement indisponible",
    retryAfter: configuration ? undefined : 5,
  };
}

async function quiet(work: () => Promise<void>) {
  try {
    await work();
  } catch {
    log("warn", "lease_release_deferred", { subsystem: "rate_limit" });
  }
}

export async function admitAgentRequest(
  client: string,
  fingerprint: string,
  limits: AgentAdmissionLimits,
  providedStore?: RateLimitStore,
  now = Date.now(),
): Promise<Admission> {
  const store = providedStore ?? rateLimitStore();
  const { day, remainingMs } = utcDay(now);
  const tokens = tokenLimits();
  const leaseTtl = agentLeaseTtl(limits);
  let globalLease: string | null = null;
  let clientLease: string | null = null;

  const releaseLeases = once(async () => {
    if (clientLease) await quiet(() => store.release(clientLease!));
    if (globalLease) await quiet(() => store.release(globalLease!));
  });

  try {
    globalLease = await store.acquire("aura:inflight", limits.maxConcurrent, leaseTtl, now);
    if (!globalLease) {
      return { ok: false, status: 503, code: "saturated", error: "service d'analyse saturé, réessayez dans quelques instants", retryAfter: 2 };
    }
    clientLease = await store.acquire(`aura:inflight:${client}`, limits.perClientConcurrent, leaseTtl, now);
    if (!clientLease) {
      await releaseLeases();
      return { ok: false, status: 429, code: "client_concurrency", error: "une seule requête concurrente par client", retryAfter: 1 };
    }

    const minute = minuteWindow(now);
    const checks: Array<Consumption & { code: string; error: string }> = [
      { key: `aura:minute:${minute}`, cost: 1, limit: limits.globalPerMinute, ttlMs: MINUTE_MS, code: "global_rate", error: "limite globale par minute atteinte" },
      { key: `aura:minute:${minute}:${client}`, cost: 1, limit: limits.perClientPerMinute, ttlMs: MINUTE_MS, code: "client_rate", error: "limite de requêtes par minute atteinte" },
    ];
    if (tokens.duplicateWindowMs > 0) {
      checks.push({ key: `aura:dup:${client}:${fingerprint}`, cost: 1, limit: 1, ttlMs: tokens.duplicateWindowMs, code: "duplicate", error: "requête identique déjà reçue, patientez avant de la renvoyer" });
    }
    checks.push(
      { key: `aura:requests:${day}`, cost: 1, limit: limits.dailyRequests, ttlMs: remainingMs, code: "daily_quota", error: "quota journalier AURA épuisé" },
      { key: `aura:tokens:${day}`, cost: tokens.perRequestTokens, limit: tokens.dailyTokens, ttlMs: remainingMs, code: "daily_token_budget", error: "budget journalier de tokens AURA épuisé" },
    );
    const consumed = await store.consumeMany(checks, now);
    if (!consumed.ok) {
      await releaseLeases();
      const failed = checks[consumed.failedAt];
      return { ok: false, status: 429, code: failed.code, error: failed.error, retryAfter: retrySeconds(consumed.retryAfterMs || remainingMs) };
    }

    let finalized = false;
    const finalize = async (usage: { kind: "known"; tokens: number } | { kind: "unknown" }) => {
      if (finalized) return;
      finalized = true;
      try {
        if (usage.kind === "known") {
          const actualTokens = Number.isFinite(usage.tokens) && usage.tokens >= 0 ? Math.ceil(usage.tokens) : tokens.perRequestTokens;
          increment("aura_tokens_total", { usage: "known" }, actualTokens);
          const difference = actualTokens - tokens.perRequestTokens;
          if (difference !== 0) {
            await quiet(async () => { await store.consume(`aura:tokens:${day}`, difference, Number.POSITIVE_INFINITY, remainingMs, now); });
          }
        } else increment("aura_tokens_total", { usage: "reserved_unknown" }, tokens.perRequestTokens);
      } finally {
        await releaseLeases();
      }
    };
    return {
      ok: true,
      completedWithUsage: (actualTokens) => finalize({ kind: "known", tokens: actualTokens }),
      failedWithUnknownUsage: () => finalize({ kind: "unknown" }),
    };
  } catch (error) {
    await releaseLeases();
    return backendFailure(error);
  }
}

export type VoiceAdmissionLimits = { perMinute: number; maxCharsPerDay: number };

export function voiceConcurrency() {
  return {
    maxConcurrent: bounded("AURA_TTS_MAX_CONCURRENT", 4, 1, 32),
    perClientConcurrent: bounded("AURA_TTS_CLIENT_CONCURRENT", 2, 1, 8),
  };
}

export async function admitVoiceRequest(
  client: string,
  chars: number,
  limits: VoiceAdmissionLimits,
  providedStore?: RateLimitStore,
  now = Date.now(),
): Promise<{ ok: true; release: () => Promise<void>; refund: () => Promise<void> } | Rejection> {
  const store = providedStore ?? rateLimitStore();
  const { day, remainingMs } = utcDay(now);
  const concurrency = voiceConcurrency();
  const leaseTtl = voiceLeaseTtl();
  let globalLease: string | null = null;
  let clientLease: string | null = null;
  const release = once(async () => {
    if (clientLease) await quiet(() => store.release(clientLease!));
    if (globalLease) await quiet(() => store.release(globalLease!));
  });

  try {
    globalLease = await store.acquire("voice:inflight", concurrency.maxConcurrent, leaseTtl, now);
    if (!globalLease) return { ok: false, status: 503, code: "saturated", error: "synthèse vocale saturée", retryAfter: 2 };
    clientLease = await store.acquire(`voice:inflight:${client}`, concurrency.perClientConcurrent, leaseTtl, now);
    if (!clientLease) {
      await release();
      return { ok: false, status: 429, code: "client_concurrency", error: "trop de segments vocaux simultanés", retryAfter: 1 };
    }

    const minute = minuteWindow(now);
    const checks: Array<Consumption & { code: string; error: string }> = [
      { key: `voice:minute:${minute}`, cost: 1, limit: limits.perMinute, ttlMs: MINUTE_MS, code: "rate", error: "trop de segments vocaux par minute" },
      { key: `voice:minute:${minute}:${client}`, cost: 1, limit: limits.perMinute, ttlMs: MINUTE_MS, code: "rate", error: "trop de segments vocaux par minute" },
      { key: `voice:chars:${day}`, cost: chars, limit: limits.maxCharsPerDay, ttlMs: remainingMs, code: "daily_budget", error: "budget vocal journalier atteint : la voix du navigateur reste disponible" },
    ];
    const consumed = await store.consumeMany(checks, now);
    if (!consumed.ok) {
      await release();
      const failed = checks[consumed.failedAt];
      return { ok: false, status: 429, code: failed.code, error: failed.error, retryAfter: retrySeconds(consumed.retryAfterMs || remainingMs) };
    }
    const refund = once(() => quiet(async () => { await store.consume(`voice:chars:${day}`, -chars, Number.POSITIVE_INFINITY, remainingMs, now); }));
    return { ok: true, release, refund };
  } catch (error) {
    await release();
    return backendFailure(error);
  }
}
