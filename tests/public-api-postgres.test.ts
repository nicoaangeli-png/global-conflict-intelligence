import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { PostgresRateLimitStore } from "@/server/aura/postgresRateLimit";

const url = process.env.ORBITAL_TEST_DATABASE_URL?.trim();
let serial = 0;

describe.skipIf(!url)("API publiques distribuées PostgreSQL 17", () => {
  let admin: Pool;
  let schema: string;
  let first: PostgresRateLimitStore;
  let second: PostgresRateLimitStore;

  beforeEach(async () => {
    schema = `public_api_${process.pid}_${++serial}_${Date.now().toString(36)}`;
    admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    first = new PostgresRateLimitStore({ connectionString: url!, schema, max: 4 });
    second = new PostgresRateLimitStore({ connectionString: url!, schema, max: 4 });
    await Promise.all([first.peek("ready:one"), second.peek("ready:two")]);
  });
  afterEach(async () => {
    await Promise.all([first?.close(), second?.close()]);
    if (admin) {
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => undefined);
      await admin.end();
    }
  });

  it("admet une seule instance sur le dernier crédit et jamais plus de 20 sur 100", async () => {
    await first.consume("public:events:client", 9, 10, 60_000);
    const pair = await Promise.all([
      first.consume("public:events:client", 1, 10, 60_000),
      second.consume("public:events:client", 1, 10, 60_000),
    ]);
    expect(pair.filter((item) => item.ok)).toHaveLength(1);
    expect(await first.peek("public:events:client")).toBe(10);
    const burst = await Promise.all(Array.from({ length: 100 }, (_, i) =>
      (i % 2 ? first : second).consume("public:stats:global", 1, 20, 60_000)));
    expect(burst.filter((item) => item.ok)).toHaveLength(20);
    expect(await second.peek("public:stats:global")).toBe(20);
  });

  it("rollback atomique des quotas global et client si le dernier échoue", async () => {
    await first.consume("public:cluster:client", 1, 1, 60_000);
    const denied = await second.consumeMany([
      { key: "public:cluster:global", cost: 1, limit: 10, ttlMs: 60_000 },
      { key: "public:cluster:client", cost: 1, limit: 1, ttlMs: 60_000 },
    ]);
    expect(denied.ok).toBe(false);
    expect(await first.peek("public:cluster:global")).toBe(0);
    const rows = await admin.query(`SELECT count(*)::int AS n FROM "${schema}".aura_rate_limit_counters WHERE value < 0`);
    expect(rows.rows[0].n).toBe(0);
  });

  it("limite les connexions entre deux stores, libère et expire après crash", async () => {
    const firstLease = await first.acquire("sse:active:global", 1, 1000);
    expect(firstLease).toBeTruthy();
    expect(await second.acquire("sse:active:global", 1, 1000)).toBeNull();
    await first.release(firstLease!);
    const secondLease = await second.acquire("sse:active:global", 1, 1000);
    expect(secondLease).toBeTruthy();
    expect(await first.acquire("sse:active:global", 1, 1000, Date.now() + 1001)).toBeTruthy();
    const rows = await admin.query(`SELECT count(*)::int AS n FROM "${schema}".aura_rate_limit_leases WHERE expires_at > now() + interval '1 hour'`);
    expect(rows.rows[0].n).toBe(0);
  });

  it("borne exactement les acquisitions SSE concurrentes entre deux processus", async () => {
    const leases = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      (index % 2 ? first : second).acquire("sse:active:concurrent", 3, 60_000)));
    expect(leases.filter(Boolean)).toHaveLength(3);
    await Promise.all(leases.filter((id): id is string => Boolean(id)).map((id) => first.release(id)));
    const rows = await admin.query(`SELECT count(*)::int AS n FROM "${schema}".aura_rate_limit_leases WHERE namespace = 'sse:active'`);
    expect(rows.rows[0].n).toBe(0);
  });

  it("ne persiste aucune IP brute dans les compteurs ou les leases", async () => {
    const key = "public:events:ip:198.51.100.42:minute";
    await first.consume(key, 1, 10, 60_000);
    await second.acquire("sse:active:ip:198.51.100.42", 1, 1000);
    const result = await admin.query(`SELECT namespace, key_hash FROM "${schema}".aura_rate_limit_counters UNION ALL SELECT namespace, key_hash FROM "${schema}".aura_rate_limit_leases`);
    expect(JSON.stringify(result.rows)).not.toContain("198.51.100.42");
  });

  it("le nettoyage saute une ligne verrouillée sans bloquer les autres compteurs expirés", async () => {
    const sweeping = new PostgresRateLimitStore({ connectionString: url!, schema, max: 2, sweepEvery: 1 });
    await sweeping.peek("ready:sweep");
    await admin.query(`INSERT INTO "${schema}".aura_rate_limit_counters(namespace, key_hash, value, expires_at) VALUES
      ('expired', repeat('a', 64), 1, now() - interval '1 minute'),
      ('expired', repeat('b', 64), 1, now() - interval '1 minute')`);
    const blocker = await admin.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(`SELECT 1 FROM "${schema}".aura_rate_limit_counters WHERE key_hash = repeat('a', 64) FOR UPDATE`);
      expect(await sweeping.consume("public:sweep:trigger", 1, 10, 60_000)).toMatchObject({ ok: true });
      await vi.waitFor(async () => {
        const rows = await admin.query(`SELECT count(*)::int AS n FROM "${schema}".aura_rate_limit_counters WHERE namespace = 'expired' AND key_hash = repeat('b', 64)`);
        expect(rows.rows[0].n).toBe(0);
      }, { timeout: 2000 });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await sweeping.close();
    }
  });
});
