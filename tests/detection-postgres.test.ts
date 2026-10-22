import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import { migratePostgres, POSTGRES_MIGRATIONS, POSTGRES_SCHEMA_VERSION } from "@/server/migrations/postgres";
import { DetectionEngine } from "@/server/detection/engine";
import { PostgresDetectionStore } from "@/server/detection/postgresStore";
import { redactSecrets } from "@/server/security/redact";
import { distinct, NOW, signal, sqliteContext } from "./detection-store-helpers";

/**
 * Tests PostgreSQL réels (schéma isolé par suite). Ignorés sans
 * ORBITAL_TEST_DATABASE_URL. Le mot de passe éventuel de l'URL n'est jamais affiché.
 */
const url = process.env.ORBITAL_TEST_DATABASE_URL?.trim();
const suite = url ? describe : describe.skip;
let schemaIndex = 0;

async function schemaPool(schema: string): Promise<Pool> {
  return new Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` });
}

async function createSchema(admin: Pool): Promise<string> {
  const schema = `detection_pg_${process.pid}_${++schemaIndex}_${Date.now().toString(36)}`.slice(0, 60);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  return schema;
}

suite("détection PostgreSQL (base réelle)", () => {
  let admin: Pool;
  const pools: Pool[] = [];

  beforeAll(async () => { admin = new Pool({ connectionString: url, max: 2 }); });
  afterAll(async () => {
    for (const pool of pools) await pool.end().catch(() => undefined);
    await admin.end();
  });

  const poolFor = async (schema: string) => {
    const pool = await schemaPool(schema);
    pools.push(pool);
    return pool;
  };

  it("schéma vierge : tables, index et version de migration", async () => {
    const schema = await createSchema(admin);
    const pool = await poolFor(schema);
    expect(await migratePostgres(pool)).toMatchObject({ from: 0, to: POSTGRES_SCHEMA_VERSION, applied: [1, 2, 3, 4, 5] });

    const tables = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
      [schema],
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "aura_rate_limit_counters", "aura_rate_limit_leases", "conflict_events", "detection_events", "detection_signals", "orbital_schema_migrations",
    ]);
    const indexes = await pool.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE schemaname = $1", [schema]);
    const names = indexes.rows.map((row) => row.indexname);
    for (const index of ["detection_candidates", "detection_matching_order", "detection_retention", "detection_recent", "detection_signals_event"]) {
      expect(names).toContain(index);
    }
    // Rejouer les migrations est un no-op.
    expect(await migratePostgres(pool)).toEqual({ from: POSTGRES_SCHEMA_VERSION, to: POSTGRES_SCHEMA_VERSION, applied: [] });
  });

  it("base v3 existante : la migration v4 ajoute la détection sans toucher aux conflits", async () => {
    const schema = await createSchema(admin);
    const pool = await poolFor(schema);
    expect(await migratePostgres(pool, POSTGRES_MIGRATIONS.slice(0, 3))).toMatchObject({ from: 0, to: 3, applied: [1, 2, 3] });
    await pool.query(
      `INSERT INTO conflict_events (id, source_dataset, latitude, longitude, country, event_type, confidence, event_date)
       VALUES ('conflit-ancien', 'ucdp', 15.5, 32.5, 'Sudan', 'Battles', 'VERIFIED', now() - interval '1 day')`,
    );
    expect(await migratePostgres(pool)).toMatchObject({ from: 3, applied: [4, 5] });
    const conflict = await pool.query("SELECT country, event_type FROM conflict_events WHERE id = 'conflit-ancien'");
    expect(conflict.rows[0]).toMatchObject({ country: "Sudan", event_type: "Battles" });
    expect((await pool.query("SELECT to_regclass('detection_events') AS t")).rows[0].t).toBe("detection_events");
  });

  it("démarrages simultanés : une seule application de la migration v4", async () => {
    const schema = await createSchema(admin);
    const first = await poolFor(schema);
    const second = await poolFor(schema);
    const third = await poolFor(schema);
    const reports = await Promise.all([migratePostgres(first), migratePostgres(second), migratePostgres(third)]);
    expect(reports.flatMap((report) => report.applied)).toEqual([1, 2, 3, 4, 5]);
  });

  it("migration en échec : transaction intégralement annulée", async () => {
    const schema = await createSchema(admin);
    const pool = await poolFor(schema);
    await expect(migratePostgres(pool, [
      { version: 1, name: "ok", sql: "CREATE TABLE migration_partielle (id INTEGER PRIMARY KEY);" },
      { version: 2, name: "invalide", sql: "CREATE TABLE;" },
    ])).rejects.toBeDefined();
    expect((await pool.query("SELECT to_regclass('migration_partielle') AS t")).rows[0].t).toBeNull();
    expect((await pool.query("SELECT to_regclass('orbital_schema_migrations') AS t")).rows[0].t).toBeNull();
  });

  it("refuse une base au schéma plus récent et un schéma de détection incompatible", async () => {
    const schema = await createSchema(admin);
    const pool = await poolFor(schema);
    await migratePostgres(pool);
    await pool.query("INSERT INTO orbital_schema_migrations (version, name) VALUES ($1, 'future')", [POSTGRES_SCHEMA_VERSION + 1]);
    await expect(migratePostgres(pool)).rejects.toThrow(/plus récent/);
    const store = new PostgresDetectionStore({ connectionString: url!, schema });
    await expect(store.transaction((transaction) => transaction.recent(1))).rejects.toThrow(/plus récent/);
    await store.close();

    // Même si la table de versions est réparée, un type altéré est refusé.
    const other = await createSchema(admin);
    const otherPool = await poolFor(other);
    await migratePostgres(otherPool);
    await otherPool.query("ALTER TABLE detection_events ALTER COLUMN payload TYPE text USING payload::text");
    const incompatible = new PostgresDetectionStore({ connectionString: url!, schema: other });
    await expect(incompatible.transaction((transaction) => transaction.recent(1))).rejects.toThrow(/Incompatible detection schema/);
    await incompatible.close();
  });

  it("requêtes critiques : les index sont choisis par le planificateur", async () => {
    const schema = await createSchema(admin);
    const pool = await poolFor(schema);
    await migratePostgres(pool);
    await pool.query(
      `INSERT INTO detection_events (id, kind, anchor, last_received, payload)
       SELECT 'perf-' || g, 'explosion', $1::double precision + g, now() - (g || ' seconds')::interval,
              jsonb_build_object('id', 'perf-' || g, 'kind', 'explosion')
         FROM generate_series(1, 5000) AS g`,
      [NOW - 86_400_000],
    );
    await pool.query("ANALYZE detection_events");

    const client: PoolClient = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      const candidates = await client.query(
        `EXPLAIN (FORMAT JSON) SELECT payload, anchor, id FROM detection_events
          WHERE kind = 'explosion' AND anchor BETWEEN $1 AND $2
          ORDER BY anchor DESC, id DESC LIMIT 64`, [NOW - 45 * 60_000, NOW],
      );
      expect(JSON.stringify(candidates.rows)).toMatch(/detection_(candidates|matching_order)/);
      const recent = await client.query(
        "EXPLAIN (FORMAT JSON) SELECT payload FROM detection_events ORDER BY last_received DESC, id LIMIT 200",
      );
      expect(JSON.stringify(recent.rows)).toMatch(/detection_recent/);
      const purge = await client.query(
        "EXPLAIN (FORMAT JSON) DELETE FROM detection_events WHERE anchor < $1", [NOW],
      );
      expect(JSON.stringify(purge.rows)).toMatch(/detection_retention/);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("le même scénario donne le même snapshot que SQLite", async () => {
    const schema = await createSchema(admin);
    const postgres = new PostgresDetectionStore({ connectionString: url!, schema });
    const sqlite = await sqliteContext();
    try {
      const scenario = async (engine: DetectionEngine) => {
        await engine.ingest([signal(), distinct(1)], NOW);
        await engine.ingest([signal()], NOW + 1_000);
        await engine.ingest([distinct(2, { nature: "official", confirmsOccurrence: true })], NOW + 120_000);
        return engine.snapshot(NOW + 120_000);
      };
      const [pgSnapshot, liteSnapshot] = await Promise.all([scenario(new DetectionEngine(postgres)), scenario(sqlite.engine)]);
      expect(pgSnapshot.status).toBe("ok");
      expect(liteSnapshot.status).toBe("ok");
      expect(pgSnapshot.events).toEqual(liteSnapshot.events);
      expect(pgSnapshot.live).toEqual(liteSnapshot.live);
    } finally {
      await postgres.close();
      await sqlite.cleanup();
    }
  });

  it("aucun secret de connexion ne fuit par le masquage", () => {
    const secret = "postgresql://orbital:mot-de-passe-très-secret@example.invalid/orbital";
    vi.stubEnv("DATABASE_URL", secret);
    try {
      const message = redactSecrets(`connexion impossible : ${secret}`);
      expect(message).not.toContain("mot-de-passe-très-secret");
      expect(message).not.toContain("example.invalid");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
