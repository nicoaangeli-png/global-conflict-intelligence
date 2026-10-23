import { afterEach, describe, expect, it, vi } from "vitest";
import { admitAgentRequest, admitVoiceRequest } from "@/server/aura/budget";
import { MemoryRateLimitStore, utcDay } from "@/server/aura/rateLimit";
import { rateLimitStore, resetRateLimitStore } from "@/server/aura/rateLimitStore";

const NOW = Date.parse("2026-10-22T12:00:00Z");

describe("contrat MemoryRateLimitStore", () => {
  it("consomme atomiquement jusqu'à la limite et change de fenêtre après expiration", async () => {
    const store = new MemoryRateLimitStore();
    expect(await store.consume("minute:a", 9, 10, 60_000, NOW)).toEqual({ ok: true, used: 9 });
    const results = await Promise.all([
      store.consume("minute:a", 1, 10, 60_000, NOW),
      store.consume("minute:a", 1, 10, 60_000, NOW),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await store.peek("minute:a", NOW)).toBe(10);
    expect(await store.consume("minute:a", 1, 10, 60_000, NOW + 60_000)).toEqual({ ok: true, used: 1 });
  });

  it("annule tout le groupe si un quota quotidien, tokens ou TTS échoue", async () => {
    const store = new MemoryRateLimitStore();
    await store.consume("daily", 9, 10, 86_400_000, NOW);
    const failed = await store.consumeMany([
      { key: "minute", cost: 1, limit: 10, ttlMs: 60_000 },
      { key: "daily", cost: 2, limit: 10, ttlMs: 86_400_000 },
      { key: "tts", cost: 100, limit: 1000, ttlMs: 86_400_000 },
    ], NOW);
    expect(failed).toMatchObject({ ok: false, failedAt: 1 });
    expect(await store.peek("minute", NOW)).toBe(0);
    expect(await store.peek("daily", NOW)).toBe(9);
    expect(await store.peek("tts", NOW)).toBe(0);
  });

  it("cumule une clé répétée dans un groupe sans perdre l'atomicité", async () => {
    const store = new MemoryRateLimitStore();
    expect(await store.consumeMany([
      { key: "shared", cost: 4, limit: 10, ttlMs: 60_000 },
      { key: "shared", cost: 6, limit: 10, ttlMs: 60_000 },
    ], NOW)).toEqual({ ok: true, used: [10, 10] });
    expect(await store.peek("shared", NOW)).toBe(10);

    expect(await store.consumeMany([
      { key: "other", cost: 1, limit: 10, ttlMs: 60_000 },
      { key: "shared", cost: 1, limit: 10, ttlMs: 60_000 },
    ], NOW)).toMatchObject({ ok: false, failedAt: 1 });
    expect(await store.peek("other", NOW)).toBe(0);
  });

  it("ne produit jamais un compteur négatif lors d'un remboursement", async () => {
    const store = new MemoryRateLimitStore();
    expect(await store.consume("voice:chars", -100, Infinity, 60_000, NOW)).toEqual({ ok: true, used: 0 });
    await store.consume("voice:chars", 50, 100, 60_000, NOW);
    expect(await store.consume("voice:chars", -80, Infinity, 60_000, NOW)).toEqual({ ok: true, used: 0 });
  });

  it("gère acquire, release idempotente et récupération après expiration de lease", async () => {
    const store = new MemoryRateLimitStore();
    const first = await store.acquire("inflight", 1, 1_000, NOW);
    expect(first).toBeTruthy();
    expect(await store.acquire("inflight", 1, 1_000, NOW)).toBeNull();
    await store.release(first!);
    await store.release(first!);
    const second = await store.acquire("inflight", 1, 1_000, NOW);
    expect(second).toBeTruthy();
    expect(await store.acquire("inflight", 1, 1_000, NOW + 1_001)).toBeTruthy();
  });

  it("déduplique un fingerprint seulement pendant son TTL", async () => {
    const store = new MemoryRateLimitStore();
    expect((await store.consume("dup:hash-only", 1, 1, 10_000, NOW)).ok).toBe(true);
    expect((await store.consume("dup:hash-only", 1, 1, 10_000, NOW + 1)).ok).toBe(false);
    expect((await store.consume("dup:hash-only", 1, 1, 10_000, NOW + 10_000)).ok).toBe(true);
  });
});

describe("sélection explicite du backend", () => {
  afterEach(async () => {
    await resetRateLimitStore();
    vi.unstubAllEnvs();
  });

  it("échoue fermé en production si auto ne dispose pas de PostgreSQL", async () => {
    await resetRateLimitStore();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AURA_RATE_LIMIT_BACKEND", "auto");
    const store = rateLimitStore();
    expect(store.health()).toEqual({ backend: "postgres", distributed: true, status: "unavailable" });
    await expect(store.peek("test")).rejects.toMatchObject({ code: "rate_limit_config" });
  });

  it("n'utilise memory en production que sur choix explicite et observable", async () => {
    await resetRateLimitStore();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AURA_RATE_LIMIT_BACKEND", "memory");
    expect(rateLimitStore().health()).toEqual({ backend: "memory", distributed: false, status: "healthy" });
  });
});

describe("finalisation conservatrice du budget tokens", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  const limits = {
    maxConcurrent: 1,
    perClientConcurrent: 1,
    perClientPerMinute: 10,
    globalPerMinute: 10,
    dailyRequests: 10,
  };

  async function admission() {
    vi.stubEnv("AURA_DAILY_TOKEN_BUDGET", "10000");
    vi.stubEnv("AURA_MAX_TOKENS_PER_REQUEST", "5000");
    vi.stubEnv("AURA_DUPLICATE_WINDOW_MS", "0");
    const store = new MemoryRateLimitStore();
    const admitted = await admitAgentRequest("client", "fingerprint", limits, store, NOW);
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) throw new Error("admission attendue");
    return { store, admitted, key: `aura:tokens:${utcDay(NOW).day}` };
  }

  it("rembourse seulement la différence lorsque l'usage fiable est inférieur", async () => {
    const { store, admitted, key } = await admission();
    await admitted.completedWithUsage(1_200);
    await admitted.completedWithUsage(1_200);
    expect(await store.peek(key, NOW)).toBe(1_200);
  });

  it("ne modifie pas la réservation lorsque l'usage fiable est égal", async () => {
    const { store, admitted, key } = await admission();
    await admitted.completedWithUsage(5_000);
    expect(await store.peek(key, NOW)).toBe(5_000);
  });

  it("comptabilise un usage fiable supérieur à la réservation", async () => {
    const { store, admitted, key } = await admission();
    await admitted.completedWithUsage(6_000);
    expect(await store.peek(key, NOW)).toBe(6_000);
  });

  it("conserve la réservation lorsque l'usage final est inconnu", async () => {
    const { store, admitted, key } = await admission();
    await admitted.failedWithUnknownUsage();
    await admitted.completedWithUsage(0);
    expect(await store.peek(key, NOW)).toBe(5_000);
  });

  it("rapproche la journée d'admission après minuit UTC", async () => {
    const beforeMidnight = Date.parse("2026-10-22T23:59:58Z");
    const afterMidnight = Date.parse("2026-10-23T00:00:02Z");
    vi.stubEnv("AURA_DAILY_TOKEN_BUDGET", "10000");
    vi.stubEnv("AURA_MAX_TOKENS_PER_REQUEST", "5000");
    vi.stubEnv("AURA_DUPLICATE_WINDOW_MS", "0");
    const store = new MemoryRateLimitStore();
    const admitted = await admitAgentRequest("client", "fingerprint", limits, store, beforeMidnight);
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) throw new Error("admission attendue");
    vi.useFakeTimers();
    vi.setSystemTime(afterMidnight);
    await admitted.completedWithUsage(1_200);
    expect(await store.peek(`aura:tokens:${utcDay(beforeMidnight).day}`, beforeMidnight)).toBe(1_200);
    expect(await store.peek(`aura:tokens:${utcDay(afterMidnight).day}`, afterMidnight)).toBe(0);
  });
});

describe("remboursement TTS dans la journée d'admission", () => {
  afterEach(() => vi.useRealTimers());

  it("rembourse les caractères réservés même après minuit UTC", async () => {
    const beforeMidnight = Date.parse("2026-10-22T23:59:58Z");
    const afterMidnight = Date.parse("2026-10-23T00:00:02Z");
    const store = new MemoryRateLimitStore();
    const consume = vi.spyOn(store, "consume");
    const admitted = await admitVoiceRequest("client", 80, { perMinute: 10, maxCharsPerDay: 100 }, store, beforeMidnight);
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) throw new Error("admission attendue");
    vi.useFakeTimers();
    vi.setSystemTime(afterMidnight);
    await admitted.refund();
    await admitted.release();
    expect(consume).toHaveBeenCalledWith(`voice:chars:${utcDay(beforeMidnight).day}`, -80, Infinity, 2_000, beforeMidnight);
    expect(await store.peek(`voice:chars:${utcDay(beforeMidnight).day}`, beforeMidnight)).toBe(0);
    expect(await store.peek(`voice:chars:${utcDay(afterMidnight).day}`, afterMidnight)).toBe(0);
  });
});
