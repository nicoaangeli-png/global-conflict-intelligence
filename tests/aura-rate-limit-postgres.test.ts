import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { PostgresRateLimitStore } from "@/server/aura/postgresRateLimit";

const url = process.env.ORBITAL_TEST_DATABASE_URL?.trim();
const NOW = Date.parse("2026-10-22T12:00:00Z");
let sequence = 0;

describe.skipIf(!url)("PostgresRateLimitStore distribué", () => {
  let admin: Pool;
  let schema: string;
  let first: PostgresRateLimitStore;
  let second: PostgresRateLimitStore;

  beforeEach(async () => {
    schema = `aura_limit_${process.pid}_${++sequence}_${Date.now().toString(36)}`;
    admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    first = new PostgresRateLimitStore({ connectionString: url!, schema, max: 4 });
    second = new PostgresRateLimitStore({ connectionString: url!, schema, max: 4 });
    await Promise.all([
      first.peek("ready:first", NOW),
      second.peek("ready:second", NOW),
    ]);
  });

  afterEach(async () => {
    await Promise.all([first.close(), second.close()]);
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => undefined);
    await admin.end();
  });

  it("n'autorise qu'une consommation sur les deux concurrentes au dernier crédit", async () => {
    await first.consume("aura:minute:client", 9, 10, 60_000, NOW);
    const results = await Promise.all([
      first.consume("aura:minute:client", 1, 10, 60_000, NOW),
      second.consume("aura:minute:client", 1, 10, 60_000, NOW),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await first.peek("aura:minute:client", NOW)).toBe(10);
  });

  it("borne exactement une forte concurrence à 20 consommations", async () => {
    const results = await Promise.all(Array.from({ length: 100 }, (_, index) =>
      (index % 2 ? first : second).consume("aura:minute:global", 1, 20, 60_000, NOW),
    ));
    expect(results.filter((result) => result.ok)).toHaveLength(20);
    expect(results.filter((result) => !result.ok)).toHaveLength(80);
    expect(await second.peek("aura:minute:global", NOW)).toBe(20);
  });

  it("applique la même atomicité aux quotas journaliers, tokens et caractères TTS", async () => {
    for (const key of ["aura:requests:day", "aura:tokens:day", "voice:chars:day"]) {
      await first.consume(key, 9, 10, 86_400_000, NOW);
      const results = await Promise.all([
        first.consume(key, 1, 10, 86_400_000, NOW),
        second.consume(key, 1, 10, 86_400_000, NOW),
      ]);
      expect(results.filter((result) => result.ok), key).toHaveLength(1);
      expect(await first.peek(key, NOW), key).toBe(10);
    }
  });

  it("récupère une lease après crash simulé et rend release idempotente", async () => {
    const lease = await first.acquire("aura:inflight:client", 1, 1_000, NOW);
    expect(lease).toBeTruthy();
    expect(await second.acquire("aura:inflight:client", 1, 1_000, NOW)).toBeNull();
    expect(await second.acquire("aura:inflight:client", 1, 1_000, NOW + 1_001)).toBeTruthy();
    await Promise.all([first.release(lease!), second.release(lease!)]);
    const rows = await admin.query(`SELECT count(*)::int AS n FROM "${schema}".aura_rate_limit_leases WHERE lease_id = $1`, [lease]);
    expect(rows.rows[0].n).toBe(0);
  });

  it("n'admet qu'une instance pour le même fingerprint", async () => {
    const results = await Promise.all([
      first.consume("aura:dup:client:sha256", 1, 1, 10_000, NOW),
      second.consume("aura:dup:client:sha256", 1, 1, 10_000, NOW),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await first.consume("aura:dup:client:sha256", 1, 1, 10_000, NOW + 10_001)).toMatchObject({ ok: true });
  });

  it("annule intégralement une consommation groupée qui échoue au milieu", async () => {
    await expect(first.consumeMany([
      { key: "aura:minute:rollback", cost: 1, limit: 10, ttlMs: 60_000 },
      { key: "invalid", cost: 0, limit: 10, ttlMs: 60_000 },
    ], NOW)).rejects.toMatchObject({ code: "rate_limit_config" });
    expect(await second.peek("aura:minute:rollback", NOW)).toBe(0);
  });

  it("verrouille les lots A-B et B-A dans le même ordre global", async () => {
    await first.peek("ready", NOW);
    await admin.query(`
      CREATE FUNCTION "${schema}".slow_counter_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_sleep(0.05);
        RETURN NEW;
      END $$;
      CREATE TRIGGER slow_counter_mutation
      BEFORE INSERT OR UPDATE ON "${schema}".aura_rate_limit_counters
      FOR EACH ROW EXECUTE FUNCTION "${schema}".slow_counter_mutation()
    `);
    const [forward, reverse] = await Promise.all([
      first.consumeMany([
        { key: "counter:A", cost: 1, limit: 10, ttlMs: 60_000 },
        { key: "counter:B", cost: 1, limit: 10, ttlMs: 60_000 },
      ], NOW),
      second.consumeMany([
        { key: "counter:B", cost: 1, limit: 10, ttlMs: 60_000 },
        { key: "counter:A", cost: 1, limit: 10, ttlMs: 60_000 },
      ], NOW),
    ]);
    expect([forward.ok, reverse.ok]).toEqual([true, true]);
    expect(await first.peek("counter:A", NOW)).toBe(2);
    expect(await second.peek("counter:B", NOW)).toBe(2);
  });

  it("agrège les occurrences répétées d'une clé dans une seule consommation", async () => {
    const result = await first.consumeMany([
      { key: "counter:repeated", cost: 2, limit: 10, ttlMs: 60_000 },
      { key: "counter:repeated", cost: 3, limit: 10, ttlMs: 60_000 },
    ], NOW);
    expect(result).toEqual({ ok: true, used: [5, 5] });
    expect(await second.peek("counter:repeated", NOW)).toBe(5);
  });

  async function installDeleteTrigger(table: "counters" | "leases", body: string) {
    const tableName = `aura_rate_limit_${table}`;
    await admin.query(`
      CREATE FUNCTION "${schema}".sweep_hook() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        ${body}
        RETURN OLD;
      END $$;
      CREATE TRIGGER sweep_hook BEFORE DELETE ON "${schema}".${tableName}
      FOR EACH ROW EXECUTE FUNCTION "${schema}".sweep_hook()
    `);
  }

  it("ne transforme pas un consume commité en échec si le sweep échoue", async () => {
    const sweeping = new PostgresRateLimitStore({ connectionString: url!, schema, max: 2, sweepEvery: 1 });
    await sweeping.peek("ready", NOW);
    await admin.query(`INSERT INTO "${schema}".aura_rate_limit_counters(namespace, key_hash, value, expires_at) VALUES ('expired', repeat('a', 64), 1, $1)`, [new Date(NOW - 1)]);
    await installDeleteTrigger("counters", "RAISE EXCEPTION 'sweep failure';");
    expect(await sweeping.consume("counter:committed", 1, 10, 60_000, NOW)).toEqual({ ok: true, used: 1 });
    await vi.waitFor(() => expect(sweeping.health().status).toBe("degraded"));
    expect(await sweeping.peek("counter:committed", NOW)).toBe(1);
    await sweeping.close();
  });

  it("retourne une lease commitée même si le sweep échoue", async () => {
    const sweeping = new PostgresRateLimitStore({ connectionString: url!, schema, max: 2, sweepEvery: 1 });
    await sweeping.peek("ready", NOW);
    await admin.query(`INSERT INTO "${schema}".aura_rate_limit_leases(lease_id, namespace, key_hash, expires_at) VALUES ('expired', 'expired', repeat('b', 64), $1)`, [new Date(NOW - 1)]);
    await installDeleteTrigger("leases", "RAISE EXCEPTION 'sweep failure';");
    const lease = await sweeping.acquire("lease:committed", 1, 60_000, NOW);
    expect(lease).toBeTruthy();
    await vi.waitFor(() => expect(sweeping.health().status).toBe("degraded"));
    expect((await admin.query(`SELECT count(*)::int AS n FROM "${schema}".aura_rate_limit_leases WHERE lease_id = $1`, [lease])).rows[0].n).toBe(1);
    await sweeping.close();
  });

  it("ne retient pas le client transactionnel pendant un sweep lent", async () => {
    const sweeping = new PostgresRateLimitStore({ connectionString: url!, schema, max: 2, sweepEvery: 1 });
    await sweeping.peek("ready", NOW);
    await admin.query(`INSERT INTO "${schema}".aura_rate_limit_counters(namespace, key_hash, value, expires_at) VALUES ('expired', repeat('c', 64), 1, $1)`, [new Date(NOW - 1)]);
    const blocker = await admin.connect();
    await blocker.query("SELECT pg_advisory_lock(7348291)");
    await installDeleteTrigger("counters", "PERFORM pg_advisory_xact_lock(7348291);");
    try {
      const result = await Promise.race([
        sweeping.consume("counter:independent", 1, 10, 60_000, NOW),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("sweep awaited by business result")), 500)),
      ]);
      expect(result).toEqual({ ok: true, used: 1 });
    } finally {
      await blocker.query("SELECT pg_advisory_unlock(7348291)");
      blocker.release();
      await sweeping.close();
    }
  });

  it("déclenche le sweep avec un pool max=1 sans se bloquer ni retenir de client", async () => {
    const sweeping = new PostgresRateLimitStore({ connectionString: url!, schema, max: 1, sweepEvery: 1 });
    await sweeping.peek("ready", NOW);
    await admin.query(`INSERT INTO "${schema}".aura_rate_limit_counters(namespace, key_hash, value, expires_at) VALUES ('expired', repeat('d', 64), 1, $1)`, [new Date(NOW - 1)]);
    const result = await Promise.race([
      sweeping.consume("counter:single-pool", 1, 10, 60_000, NOW),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pool max=1 bloqué")), 1_000)),
    ]);
    expect(result).toEqual({ ok: true, used: 1 });
    expect(await sweeping.peek("counter:single-pool", NOW)).toBe(1);
    await sweeping.close();
  });

  it("ne persiste ni IP brute, ni prompt, et partage l'état entre stores", async () => {
    const raw = "aura:minute:ip:198.51.100.42:prompt-ultra-secret";
    await first.consume(raw, 3, 10, 60_000, NOW);
    expect(await second.peek(raw, NOW)).toBe(3);
    const rows = await admin.query<{ namespace: string; key_hash: string }>(
      `SELECT namespace, key_hash FROM "${schema}".aura_rate_limit_counters`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(JSON.stringify(rows.rows)).not.toContain("198.51.100.42");
    expect(JSON.stringify(rows.rows)).not.toContain("prompt-ultra-secret");
    expect(rows.rows[0].key_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
