import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SQLITE_SCHEMA_SQL } from "@/server/migrations/sqlite";
import { migratePostgres } from "@/server/migrations/postgres";
import { PgRepository } from "@/server/repository";
import type { ConflictEvent } from "@/types/conflict";

const baseUrl = process.env.ORBITAL_TEST_DATABASE_URL?.trim();
const suite = baseUrl ? describe : describe.skip;
const script = path.resolve(process.cwd(), "scripts/migrate-intel-sqlite-to-postgres.cjs");
const schemaScript = path.resolve(process.cwd(), "scripts/prepare-orbital-postgres-schema.cjs");

type Report = {
  status: "ok" | "failed";
  mode: string;
  sqliteCount: number;
  postgresBefore: number;
  migrated: number;
  alreadyPresent: number;
  rejected: number;
  collisions: number;
  sourceChecksum: string;
  verification: null | { count: number; checksum: string; fieldComparison: boolean; dimensions: unknown };
  errors: Array<{ code: string; detail: string }>;
  dimensions: { bySource: Record<string, number>; byCategory: Record<string, number> };
};

function scopedUrl(url: string, schema: string): string {
  const value = new URL(url);
  value.searchParams.set("options", `-c search_path=${schema}`);
  return value.toString();
}

function fixture(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, sourceDataset: "ucdp", latitude: 34.1, longitude: 70.2,
    country: "Afghanistan", region: "Asia", locality: "Patan", eventType: "Battles",
    subEventType: "Clash", actors: ["A", "B"], fatalities: 2,
    source: "Verified source", sourceUrl: "https://example.org/source",
    confidence: "REPORTED", eventDate: "2026-10-21T23:59:59.123Z",
    updatedAt: "2026-10-22T00:00:00.456Z", title: null,
    ...overrides,
  };
}

function sourceFile(directory: string, events: Array<Record<string, unknown>>) {
  const filename = path.join(directory, `${Math.random().toString(36).slice(2)}.sqlite`);
  const db = new DatabaseSync(filename);
  db.exec(`${SQLITE_SCHEMA_SQL}PRAGMA user_version=1;`);
  const write = db.prepare(`INSERT INTO conflict_events (
    id, source_dataset, event_type, country, country_iso3, confidence, fatalities,
    event_date, event_ts, lat, lon, updated_at, payload
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec("BEGIN IMMEDIATE");
  for (const event of events) {
    write.run(event.id as string, event.sourceDataset as string, event.eventType as string,
      event.country as string, null, event.confidence as string, event.fatalities as number,
      event.eventDate as string, Date.parse(event.eventDate as string), event.latitude as number,
      event.longitude as number, event.updatedAt as string, JSON.stringify(event));
  }
  db.exec("COMMIT");
  db.close();
  return filename;
}

suite("migration du stockage principal SQLite vers PostgreSQL 17", () => {
  let admin: Pool;
  let pool: Pool;
  let schema: string;
  let databaseName: string;
  let directory: string;
  let targetUrl: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString: baseUrl!, max: 2 });
    databaseName = (await admin.query("SELECT current_database() AS name")).rows[0].name;
    schema = `intel_migration_${process.pid}_${Date.now().toString(36)}`.slice(0, 60);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    targetUrl = scopedUrl(baseUrl!, schema);
    pool = new Pool({ connectionString: targetUrl, max: 2 });
    await migratePostgres(pool);
    directory = mkdtempSync(path.join(os.tmpdir(), "orbital-intel-migration-"));
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE conflict_events");
  });

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    if (admin && schema) await admin.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => undefined);
    await admin?.end().catch(() => undefined);
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  const run = (filename: string, apply = false, overrides: Record<string, string> = {}): Report => {
    const arguments_ = [script, "--source", filename, "--expect-database", databaseName, ...(apply ? ["--apply"] : [])];
    const env = { ...process.env, ORBITAL_MIGRATION_DATABASE_URL: targetUrl, ...overrides };
    try {
      return JSON.parse(execFileSync(process.execPath, arguments_, { encoding: "utf8", env })) as Report;
    } catch (error) {
      const output = (error as { stdout: string }).stdout;
      return JSON.parse(output) as Report;
    }
  };

  it("ne modifie rien par défaut, copie tous les champs, puis reste idempotente", async () => {
    const events = [fixture("one", { title: null, geoPrecision: "region", extraMetadata: { a: [1, null, true] } }),
      fixture("two", { sourceDataset: "gdelt", eventType: "Media signal", actors: [], fatalities: 0 })];
    const filename = sourceFile(directory, events);
    const sourceHash = createHash("sha256").update(readFileSync(filename)).digest("hex");
    const dry = run(filename);
    expect(dry).toMatchObject({ status: "ok", mode: "dry-run", sqliteCount: 2, postgresBefore: 0, migrated: 0 });
    expect((await pool.query("SELECT count(*)::int AS n FROM conflict_events")).rows[0].n).toBe(0);
    const first = run(filename, true);
    expect(first).toMatchObject({ status: "ok", migrated: 2, alreadyPresent: 0, rejected: 0, collisions: 0 });
    expect(first.verification).toMatchObject({ count: 2, checksum: first.sourceChecksum, fieldComparison: true });
    expect(first.dimensions.bySource).toEqual({ ucdp: 1, gdelt: 1 });
    const rows = await pool.query("SELECT id, payload, updated_at, event_date, latitude, longitude FROM conflict_events ORDER BY id");
    expect(rows.rows.find((row) => row.id === "one").payload).toEqual(events[0]);
    expect(rows.rows.find((row) => row.id === "two").payload).toEqual(events[1]);
    expect(rows.rows[0].updated_at.toISOString()).toBe("2026-10-22T00:00:00.456Z");
    expect(rows.rows[0].event_date.toISOString()).toBe("2026-10-21T23:59:59.123Z");
    expect(rows.rows[0].latitude).toBe(34.1);
    expect(rows.rows[0].longitude).toBe(70.2);
    const second = run(filename, true);
    expect(second).toMatchObject({ status: "ok", migrated: 0, alreadyPresent: 2, postgresBefore: 2 });
    expect(createHash("sha256").update(readFileSync(filename)).digest("hex")).toBe(sourceHash);
  });

  it("accepte une source et une destination vides", async () => {
    const result = run(sourceFile(directory, []), true);
    expect(result).toMatchObject({ status: "ok", sqliteCount: 0, migrated: 0 });
    expect(result.verification?.count).toBe(0);
  });

  it("reprend un sous-ensemble déjà identique sans doublon", async () => {
    const first = fixture("partial-1");
    const initial = sourceFile(directory, [first]);
    expect(run(initial, true).migrated).toBe(1);
    const complete = sourceFile(directory, [first, fixture("partial-2"), fixture("partial-3")]);
    const report = run(complete, true);
    expect(report).toMatchObject({ status: "ok", sqliteCount: 3, postgresBefore: 1,
      alreadyPresent: 1, migrated: 2, postgresAfter: 3 });
    expect((await pool.query("SELECT count(*)::int AS n FROM conflict_events")).rows[0].n).toBe(3);
  });

  it("accepte une nouvelle ingestion après migration sans toucher aux IDs historiques", async () => {
    const filename = sourceFile(directory, [fixture("historical-1"), fixture("historical-2")]);
    expect(run(filename, true).status).toBe("ok");
    const before = (await pool.query("SELECT payload FROM conflict_events WHERE id = 'historical-1'")).rows[0].payload;
    const repository = new PgRepository(targetUrl);
    await repository.init();
    try {
      const result = await repository.upsert([fixture("new-after-migration") as ConflictEvent]);
      expect(result.inserted).toBe(1);
      expect((await repository.counts()).total).toBe(3);
      expect((await repository.byIds(["new-after-migration"]))[0].id).toBe("new-after-migration");
      expect((await pool.query("SELECT payload FROM conflict_events WHERE id = 'historical-1'")).rows[0].payload).toEqual(before);
    } finally {
      await repository.close?.();
    }
  });

  it("prépare le schéma seulement avec --apply et le nom de base attendu", async () => {
    const otherSchema = `intel_schema_${process.pid}_${Date.now().toString(36)}`.slice(0, 60);
    await admin.query(`CREATE SCHEMA "${otherSchema}"`);
    const url = scopedUrl(baseUrl!, otherSchema);
    const execute = (apply: boolean, name = databaseName) => {
      try {
        return JSON.parse(execFileSync(process.execPath,
          [schemaScript, "--expect-database", name, ...(apply ? ["--apply"] : [])],
          { encoding: "utf8", env: { ...process.env, ORBITAL_MIGRATION_DATABASE_URL: url } })) as { status: string; schema: { to: number } };
      } catch { return { status: "failed", schema: { to: -1 } }; }
    };
    try {
      expect(execute(false)).toMatchObject({ status: "ok", schema: { to: 0 } });
      expect(execute(true, "wrong_database").status).toBe("failed");
      expect(execute(true)).toMatchObject({ status: "ok", schema: { to: 5 } });
      expect(execute(true)).toMatchObject({ status: "ok", schema: { to: 5 } });
    } finally {
      await admin.query(`DROP SCHEMA "${otherSchema}" CASCADE`);
    }
  });

  it("refuse une collision sans écraser l'occupant", async () => {
    const filename = sourceFile(directory, [fixture("collision")]);
    await pool.query(`INSERT INTO conflict_events (id, source_dataset, latitude, longitude, country,
      region, locality, event_type, sub_event_type, actors, fatalities, source, source_url,
      confidence, event_date, updated_at, payload)
      VALUES ('collision','ucdp',1,2,'X','','','Battles','',ARRAY[]::text[],0,'','','REPORTED',
        '2026-10-21T23:59:59.123Z','2026-10-22T00:00:00.456Z','{"id":"collision","title":"occupant"}'::jsonb)`);
    const before = (await pool.query("SELECT payload FROM conflict_events WHERE id='collision'")).rows[0].payload;
    const result = run(filename, true);
    expect(result).toMatchObject({ status: "failed", collisions: 1, migrated: 0 });
    expect(result.errors.at(-1)?.code).toBe("DESTINATION_CONFLICT");
    expect((await pool.query("SELECT payload FROM conflict_events WHERE id='collision'")).rows[0].payload).toEqual(before);
  });

  it("annule tous les lots si une insertion tardive échoue", async () => {
    const filename = sourceFile(directory, Array.from({ length: 230 }, (_, i) => fixture(`e-${String(i).padStart(4, "0")}`)));
    await pool.query("ALTER TABLE conflict_events ADD CONSTRAINT migration_reject CHECK (id <> 'e-0220')");
    try {
      const result = run(filename, true);
      expect(result.status).toBe("failed");
      expect((await pool.query("SELECT count(*)::int AS n FROM conflict_events")).rows[0].n).toBe(0);
    } finally {
      await pool.query("ALTER TABLE conflict_events DROP CONSTRAINT migration_reject");
    }
  });

  it("refuse une source invalide et un schéma incompatible sans écriture", async () => {
    const filename = sourceFile(directory, [fixture("invalid")]);
    const db = new DatabaseSync(filename);
    db.prepare("UPDATE conflict_events SET country = 'Wrong' WHERE id = 'invalid'").run();
    db.close();
    const invalid = run(filename, true);
    expect(invalid.status).toBe("failed");
    expect(invalid.rejected).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM conflict_events")).rows[0].n).toBe(0);
    const other = sourceFile(directory, []);
    const incompatible = new DatabaseSync(other);
    incompatible.exec("PRAGMA user_version=2");
    incompatible.close();
    expect(run(other, true).errors.at(-1)?.code).toBe("INCOMPATIBLE_SCHEMA");
  });

  it("refuse une date non canonique et une destination contenant des lignes supplémentaires", async () => {
    const dateFile = sourceFile(directory, [fixture("date", { updatedAt: "2026-10-22T02:00:00.456+02:00" })]);
    expect(run(dateFile, true)).toMatchObject({ status: "failed", rejected: 1 });
    const filename = sourceFile(directory, [fixture("present")]);
    await pool.query(`INSERT INTO conflict_events (id, source_dataset, latitude, longitude, country,
      region, locality, event_type, sub_event_type, actors, fatalities, source, source_url,
      confidence, event_date, updated_at, payload)
      VALUES ('extra','ucdp',1,2,'X','','','Battles','',ARRAY[]::text[],0,'','','REPORTED',
        '2026-10-21T23:59:59.123Z','2026-10-22T00:00:00.456Z','{"id":"extra"}'::jsonb)`);
    const result = run(filename, true);
    expect(result).toMatchObject({ status: "failed", destinationExtras: 1, migrated: 0 });
  });

  it("refuse --apply sur une source accompagnée d'un WAL non capturé", async () => {
    const filename = sourceFile(directory, [fixture("wal-risk")]);
    writeFileSync(`${filename}-wal`, "stale-sidecar");
    const report = run(filename, true);
    expect(report.errors.at(-1)?.code).toBe("INVALID_SOURCE");
    expect((await pool.query("SELECT count(*)::int AS n FROM conflict_events")).rows[0].n).toBe(0);
  });

  it("échoue sans exposer l'URL quand PostgreSQL est indisponible", () => {
    const filename = sourceFile(directory, [fixture("network")]);
    const report = run(filename, true, { ORBITAL_MIGRATION_DATABASE_URL: "postgresql://private:test@127.0.0.1:1/missing" });
    expect(report.status).toBe("failed");
    expect(JSON.stringify(report)).not.toContain("private:test");
  });

  it("migre 10 000 événements sans N+1 puis vérifie chaque payload", async () => {
    const filename = sourceFile(directory, Array.from({ length: 10_000 }, (_, i) =>
      fixture(`load-${String(i).padStart(5, "0")}`, { fatalities: i % 5 })));
    const report = run(filename, true);
    expect(report).toMatchObject({ status: "ok", migrated: 10_000, sqliteCount: 10_000 });
    expect(report.verification).toMatchObject({ count: 10_000, checksum: report.sourceChecksum, fieldComparison: true });
  }, 30_000);

  const largeVolume = process.env.ORBITAL_MIGRATION_LARGE === "1" ? it : it.skip;
  largeVolume("mesure la reprise de 55 373 événements synthétiques", () => {
    const count = 55_373;
    const filename = sourceFile(directory, Array.from({ length: count }, (_, i) =>
      fixture(`volume-${String(i).padStart(5, "0")}`, { fatalities: i % 11 })));
    const report = run(filename, true);
    expect(report).toMatchObject({ status: "ok", sqliteCount: count, migrated: count, rejected: 0 });
    expect(report.verification?.checksum).toBe(report.sourceChecksum);
    console.info(`intel migration volume ${count}: ${JSON.stringify({
      durationMs: (report as Report & { durationMs: number }).durationMs,
      rssDeltaBytes: (report as Report & { rssDeltaBytes: number }).rssDeltaBytes,
    })}`);
  }, 120_000);

  it("sérialise deux processus migrateurs et ne duplique pas les événements", async () => {
    const filename = sourceFile(directory, Array.from({ length: 100 }, (_, i) => fixture(`parallel-${i}`)));
    const launch = () => new Promise<Report>((resolve, reject) => {
      const child = spawn(process.execPath, [script, "--source", filename, "--expect-database", databaseName, "--apply"], {
        env: { ...process.env, ORBITAL_MIGRATION_DATABASE_URL: targetUrl }, stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(JSON.parse(output) as Report) : reject(new Error(output)));
    });
    const [first, second] = await Promise.all([launch(), launch()]);
    expect(first.migrated + second.migrated).toBe(100);
    expect((await pool.query("SELECT count(*)::int AS n FROM conflict_events")).rows[0].n).toBe(100);
  });
});
