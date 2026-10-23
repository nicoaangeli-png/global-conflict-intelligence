import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { migratePostgres } from "@/server/migrations/postgres";
import {
  RateLimitBackendError,
  normalizeConsumptions,
  type Consumption,
  type ConsumeManyResult,
  type ConsumeResult,
  type RateLimitHealth,
  type RateLimitStore,
  type NormalizedConsumption,
} from "./rateLimit";

export type PostgresRateLimitOptions = {
  connectionString: string;
  max?: number;
  /** Réservé aux tests isolés. */
  schema?: string;
  /** Réservé aux tests du nettoyage opportuniste. */
  sweepEvery?: number;
};

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
const namespace = (key: string) => key.split(":").slice(0, 2).join(":").slice(0, 80) || "unknown";
const asDate = (time: number) => new Date(time);
const ADVISORY_MODULUS = 1n << 64n;
const ADVISORY_SIGN = 1n << 63n;

function counterLockId(keyHash: string): bigint {
  const raw = BigInt(`0x${createHash("sha256").update(`orbital:aura:counter:${keyHash}`).digest("hex").slice(0, 16)}`);
  return raw >= ADVISORY_SIGN ? raw - ADVISORY_MODULUS : raw;
}

type PreparedConsumption = NormalizedConsumption & {
  keyNamespace: string;
  keyHash: string;
  lockId: bigint;
};

function prepareConsumptions(items: readonly Consumption[]): PreparedConsumption[] {
  return normalizeConsumptions(items)
    .map((item) => {
      const keyHash = hashKey(item.key);
      return { ...item, keyNamespace: namespace(item.key), keyHash, lockId: counterLockId(keyHash) };
    })
    .sort((left, right) => left.lockId < right.lockId ? -1 : left.lockId > right.lockId ? 1 : left.keyHash.localeCompare(right.keyHash));
}

export class PostgresRateLimitStore implements RateLimitStore {
  readonly kind = "postgres" as const;
  readonly distributed = true;
  private readonly pool: Pool;
  private readonly ready: Promise<void>;
  private state: RateLimitHealth["status"] = "degraded";
  private operations = 0;
  private readonly sweepEvery: number;
  private readonly sweeps = new Set<Promise<void>>();

  constructor(options: string | PostgresRateLimitOptions) {
    const config = typeof options === "string" ? { connectionString: options } : options;
    const schema = config.schema?.trim();
    if (!config.connectionString.trim() || (schema && !/^[a-z_][a-z0-9_]{0,62}$/.test(schema))
      || (config.sweepEvery !== undefined && (!Number.isSafeInteger(config.sweepEvery) || config.sweepEvery < 1))) {
      throw new RateLimitBackendError("rate_limit_config");
    }
    this.sweepEvery = config.sweepEvery ?? 200;
    this.pool = new Pool({
      connectionString: config.connectionString,
      max: config.max ?? 4,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      application_name: "orbital-aura-rate-limit",
      ...(schema ? { options: `-c search_path=${schema}` } : {}),
    });
    this.pool.on("error", () => { this.state = "unavailable"; });
    this.ready = migratePostgres(this.pool).then(async () => {
      await this.pool.query("DELETE FROM aura_rate_limit_counters WHERE expires_at <= now()");
      await this.pool.query("DELETE FROM aura_rate_limit_leases WHERE expires_at <= now()");
      this.state = "healthy";
    }).catch((error) => {
      this.state = "unavailable";
      throw error;
    });
    this.ready.catch(() => undefined);
  }

  health(): RateLimitHealth {
    return { backend: this.kind, distributed: true, status: this.state };
  }

  private async available() {
    try {
      await this.ready;
    } catch {
      throw new RateLimitBackendError("rate_limit_unavailable");
    }
  }

  private failed(error: unknown): never {
    this.state = "unavailable";
    if (error instanceof RateLimitBackendError) throw error;
    throw new RateLimitBackendError("rate_limit_unavailable");
  }

  private async consumeOne(client: PoolClient, item: PreparedConsumption, now: number): Promise<ConsumeResult> {
    if (item.cost === 0) {
      const current = await client.query<{ value: string; expires_at: Date }>(
        "SELECT value, expires_at FROM aura_rate_limit_counters WHERE namespace = $1 AND key_hash = $2 AND expires_at > $3",
        [item.keyNamespace, item.keyHash, asDate(now)],
      );
      return { ok: true, used: Number(current.rows[0]?.value ?? 0) };
    }
    if (item.cost > 0 && item.cost > item.limit) return { ok: false, used: 0, retryAfterMs: item.ttlMs };
    const expiresAt = asDate(now + item.ttlMs);
    const limit = item.limit === Number.POSITIVE_INFINITY ? null : item.limit;
    const result = await client.query<{ value: string; expires_at: Date }>(
      `INSERT INTO aura_rate_limit_counters (namespace, key_hash, value, expires_at)
       VALUES ($1, $2, GREATEST(0, $3::bigint), $4)
       ON CONFLICT (namespace, key_hash) DO UPDATE SET
         value = CASE
           WHEN aura_rate_limit_counters.expires_at <= $5
             THEN GREATEST(0, $3::bigint)
           ELSE GREATEST(0, aura_rate_limit_counters.value + $3::bigint)
         END,
         expires_at = CASE
           WHEN aura_rate_limit_counters.expires_at <= $5 THEN $4
           ELSE aura_rate_limit_counters.expires_at
         END,
         updated_at = now()
       WHERE $3::bigint < 0
          OR $6::bigint IS NULL
          OR (CASE
                WHEN aura_rate_limit_counters.expires_at <= $5 THEN $3::bigint
                ELSE aura_rate_limit_counters.value + $3::bigint
              END) <= $6::bigint
       RETURNING value, expires_at`,
      [item.keyNamespace, item.keyHash, item.cost, expiresAt, asDate(now), limit],
    );
    const changed = result.rows[0];
    if (changed) return { ok: true, used: Number(changed.value) };
    const current = await client.query<{ value: string; expires_at: Date }>(
      "SELECT value, expires_at FROM aura_rate_limit_counters WHERE namespace = $1 AND key_hash = $2",
      [item.keyNamespace, item.keyHash],
    );
    const row = current.rows[0];
    return {
      ok: false,
      used: Number(row?.value ?? 0),
      retryAfterMs: Math.max(0, (row?.expires_at?.getTime() ?? now) - now),
    };
  }

  async consumeMany(items: readonly Consumption[], now = Date.now()): Promise<ConsumeManyResult> {
    const prepared = prepareConsumptions(items);
    await this.available();
    if (!prepared.length) return { ok: true, used: [] };
    const client = await this.pool.connect().catch((error) => this.failed(error));
    let committed: { ok: true; used: number[] } | undefined;
    try {
      await client.query("BEGIN");
      // Les advisory locks précèdent toute mutation et suivent l'ordre numérique global
      // de leur identifiant 64 bits, indépendamment de l'ordre fourni par l'appelant.
      for (const item of prepared) {
        await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [item.lockId.toString()]);
      }
      const used = new Array<number>(items.length);
      for (const item of prepared) {
        const result = await this.consumeOne(client, item, now);
        if (!result.ok) {
          await client.query("ROLLBACK");
          return { ok: false, failedAt: item.firstIndex, used: result.used, retryAfterMs: result.retryAfterMs };
        }
        for (const index of item.indexes) used[index] = result.used;
      }
      await client.query("COMMIT");
      this.state = "healthy";
      committed = { ok: true, used };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      return this.failed(error);
    } finally {
      client.release();
    }
    this.maybeSweep(now);
    return committed;
  }

  async consume(key: string, cost: number, limit: number, ttlMs: number, now = Date.now()): Promise<ConsumeResult> {
    const result = await this.consumeMany([{ key, cost, limit, ttlMs }], now);
    return result.ok ? { ok: true, used: result.used[0] } : { ok: false, used: result.used, retryAfterMs: result.retryAfterMs };
  }

  async peek(key: string, now = Date.now()): Promise<number> {
    await this.available();
    try {
      const result = await this.pool.query<{ value: string }>(
        "SELECT value FROM aura_rate_limit_counters WHERE namespace = $1 AND key_hash = $2 AND expires_at > $3",
        [namespace(key), hashKey(key), asDate(now)],
      );
      this.state = "healthy";
      return Number(result.rows[0]?.value ?? 0);
    } catch (error) {
      return this.failed(error);
    }
  }

  async acquire(key: string, limit: number, ttlMs: number, now = Date.now()): Promise<string | null> {
    if (!key || !Number.isSafeInteger(limit) || limit < 1 || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RateLimitBackendError("rate_limit_config");
    }
    await this.available();
    const client = await this.pool.connect().catch((error) => this.failed(error));
    const keyNamespace = namespace(key);
    const hashed = hashKey(key);
    let committedLease: string | null | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), 6)", [`orbital:aura:${hashed}`]);
      await client.query(
        "DELETE FROM aura_rate_limit_leases WHERE namespace = $1 AND key_hash = $2 AND expires_at <= $3",
        [keyNamespace, hashed, asDate(now)],
      );
      const count = await client.query<{ count: string }>(
        "SELECT count(*) AS count FROM aura_rate_limit_leases WHERE namespace = $1 AND key_hash = $2",
        [keyNamespace, hashed],
      );
      if (Number(count.rows[0]?.count ?? 0) >= limit) {
        await client.query("COMMIT");
        committedLease = null;
      } else {
        const leaseId = randomUUID();
        await client.query(
          "INSERT INTO aura_rate_limit_leases (lease_id, namespace, key_hash, expires_at) VALUES ($1, $2, $3, $4)",
          [leaseId, keyNamespace, hashed, asDate(now + ttlMs)],
        );
        await client.query("COMMIT");
        committedLease = leaseId;
      }
      this.state = "healthy";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      return this.failed(error);
    } finally {
      client.release();
    }
    this.maybeSweep(now);
    return committedLease;
  }

  async release(leaseId: string): Promise<void> {
    if (!leaseId) return;
    await this.available();
    try {
      await this.pool.query("DELETE FROM aura_rate_limit_leases WHERE lease_id = $1", [leaseId]);
      this.state = "healthy";
    } catch (error) {
      this.failed(error);
    }
  }

  private maybeSweep(now: number) {
    if (++this.operations % this.sweepEvery !== 0) return;
    const sweep = this.sweep(now)
      .catch(() => {
        this.state = "degraded";
        console.warn("[aura] nettoyage opportuniste du rate-limit différé");
      })
      .finally(() => this.sweeps.delete(sweep));
    this.sweeps.add(sweep);
  }

  private async sweep(now: number) {
    await this.pool.query(
      `DELETE FROM aura_rate_limit_counters WHERE ctid IN (
         SELECT ctid FROM aura_rate_limit_counters WHERE expires_at <= $1 LIMIT 1000 FOR UPDATE SKIP LOCKED
       )`,
      [asDate(now)],
    );
    await this.pool.query(
      `DELETE FROM aura_rate_limit_leases WHERE ctid IN (
         SELECT ctid FROM aura_rate_limit_leases WHERE expires_at <= $1 LIMIT 1000 FOR UPDATE SKIP LOCKED
       )`,
      [asDate(now)],
    );
  }

  async close() {
    await this.ready.catch(() => undefined);
    await Promise.allSettled([...this.sweeps]);
    await this.pool.end();
  }
}
