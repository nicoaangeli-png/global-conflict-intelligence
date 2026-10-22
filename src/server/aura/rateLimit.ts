import "server-only";
import { randomUUID } from "node:crypto";

export type ConsumeResult = { ok: true; used: number } | { ok: false; used: number; retryAfterMs: number };
export type Consumption = { key: string; cost: number; limit: number; ttlMs: number };
export type NormalizedConsumption = Consumption & { firstIndex: number; indexes: number[] };
export type ConsumeManyResult =
  | { ok: true; used: number[] }
  | { ok: false; failedAt: number; used: number; retryAfterMs: number };
export type RateLimitHealth = {
  backend: "memory" | "postgres";
  distributed: boolean;
  status: "healthy" | "degraded" | "unavailable";
};

export class RateLimitBackendError extends Error {
  constructor(readonly code: "rate_limit_unavailable" | "rate_limit_config") {
    super(code);
    this.name = "RateLimitBackendError";
  }
}

export interface RateLimitStore {
  readonly kind: "memory" | "postgres";
  readonly distributed: boolean;
  health(): RateLimitHealth;
  /** Groupe atomique : soit tous les compteurs sont modifiés, soit aucun. */
  consumeMany(items: readonly Consumption[], now?: number): Promise<ConsumeManyResult>;
  consume(key: string, cost: number, limit: number, ttlMs: number, now?: number): Promise<ConsumeResult>;
  peek(key: string, now?: number): Promise<number>;
  /** Retourne un identifiant de lease opaque, ou null si la capacité est épuisée. */
  acquire(key: string, limit: number, ttlMs: number, now?: number): Promise<string | null>;
  /** Libération idempotente d'une lease, sans compteur négatif possible. */
  release(leaseId: string): Promise<void>;
  close?(): Promise<void>;
}

type Counter = { value: number; expiresAt: number };
type Lease = { key: string; expiresAt: number };

function assertConsumption(item: Consumption) {
  if (!item.key || !Number.isSafeInteger(item.cost) || item.cost === 0 || item.ttlMs <= 0 || !Number.isFinite(item.ttlMs)) {
    throw new RateLimitBackendError("rate_limit_config");
  }
  if (!(item.limit === Number.POSITIVE_INFINITY || (Number.isSafeInteger(item.limit) && item.limit >= 0))) {
    throw new RateLimitBackendError("rate_limit_config");
  }
}

/** Agrège chaque clé une seule fois ; limite et TTL doivent être cohérents dans le lot. */
export function normalizeConsumptions(items: readonly Consumption[]): NormalizedConsumption[] {
  const grouped = new Map<string, NormalizedConsumption>();
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    assertConsumption(item);
    const current = grouped.get(item.key);
    if (!current) {
      grouped.set(item.key, { ...item, firstIndex: index, indexes: [index] });
      continue;
    }
    if (current.limit !== item.limit || current.ttlMs !== item.ttlMs) {
      throw new RateLimitBackendError("rate_limit_config");
    }
    const cost = current.cost + item.cost;
    if (!Number.isSafeInteger(cost)) throw new RateLimitBackendError("rate_limit_config");
    current.cost = cost;
    current.indexes.push(index);
  }
  return [...grouped.values()].sort((left, right) => left.key.localeCompare(right.key));
}

/** Magasin mono-processus explicite, principalement pour le développement et les tests. */
export class MemoryRateLimitStore implements RateLimitStore {
  readonly kind = "memory" as const;
  readonly distributed = false;
  private readonly counters = new Map<string, Counter>();
  private readonly leases = new Map<string, Lease>();
  private operations = 0;

  health(): RateLimitHealth {
    return { backend: this.kind, distributed: false, status: "healthy" };
  }

  private live(key: string, now: number): Counter | null {
    const counter = this.counters.get(key);
    if (!counter) return null;
    if (counter.expiresAt <= now) {
      this.counters.delete(key);
      return null;
    }
    return counter;
  }

  private sweep(now: number) {
    if (++this.operations % 500 !== 0 && this.counters.size + this.leases.size < 20_000) return;
    for (const [key, counter] of this.counters) if (counter.expiresAt <= now) this.counters.delete(key);
    for (const [id, lease] of this.leases) if (lease.expiresAt <= now) this.leases.delete(id);
  }

  async consumeMany(items: readonly Consumption[], now = Date.now()): Promise<ConsumeManyResult> {
    this.sweep(now);
    const normalized = normalizeConsumptions(items);
    const proposed = new Map<string, Counter>();
    const used = new Array<number>(items.length);
    for (const item of normalized) {
      const current = this.live(item.key, now);
      const value = Math.max(0, (current?.value ?? 0) + item.cost);
      if (item.cost > 0 && value > item.limit) {
        return { ok: false, failedAt: item.firstIndex, used: current?.value ?? 0, retryAfterMs: Math.max(0, (current?.expiresAt ?? now) - now) };
      }
      if (item.cost !== 0 || current) proposed.set(item.key, { value, expiresAt: current?.expiresAt ?? now + item.ttlMs });
      for (const index of item.indexes) used[index] = value;
    }
    for (const [key, counter] of proposed) this.counters.set(key, counter);
    return { ok: true, used };
  }

  async consume(key: string, cost: number, limit: number, ttlMs: number, now = Date.now()): Promise<ConsumeResult> {
    const result = await this.consumeMany([{ key, cost, limit, ttlMs }], now);
    return result.ok ? { ok: true, used: result.used[0] } : { ok: false, used: result.used, retryAfterMs: result.retryAfterMs };
  }

  async peek(key: string, now = Date.now()): Promise<number> {
    return this.live(key, now)?.value ?? 0;
  }

  async acquire(key: string, limit: number, ttlMs: number, now = Date.now()): Promise<string | null> {
    if (!key || !Number.isSafeInteger(limit) || limit < 1 || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RateLimitBackendError("rate_limit_config");
    }
    this.sweep(now);
    let held = 0;
    for (const [id, lease] of this.leases) {
      if (lease.expiresAt <= now) this.leases.delete(id);
      else if (lease.key === key) held++;
    }
    if (held >= limit) return null;
    const id = randomUUID();
    this.leases.set(id, { key, expiresAt: now + ttlMs });
    return id;
  }

  async release(leaseId: string): Promise<void> {
    this.leases.delete(leaseId);
  }
}

export const MINUTE_MS = 60_000;
export const minuteWindow = (now = Date.now()) => Math.floor(now / MINUTE_MS);

export function utcDay(now = Date.now()): { day: string; remainingMs: number } {
  const day = new Date(now).toISOString().slice(0, 10);
  const nextMidnight = Date.parse(`${day}T00:00:00.000Z`) + 86_400_000;
  return { day, remainingMs: Math.max(1, nextMidnight - now) };
}
