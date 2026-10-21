import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migratePostgres } from "@/server/migrations/postgres";
import { SQLITE_DETECTION_SCHEMA_SQL } from "@/server/detection/store";
import { event, NOW } from "./detection-store-helpers";

const url = process.env.ORBITAL_TEST_DATABASE_URL?.trim();
const suite = url ? describe : describe.skip;
const script = path.resolve(process.cwd(), "scripts/migrate-detection-sqlite-to-postgres.cjs");

function withSchema(connectionString: string, schema: string): string {
  const separator = connectionString.includes("?") ? "&" : "?";
  return `${connectionString}${separator}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
}

suite("migration volontaire des données de détection", () => {
  let admin: Pool;
  let pool: Pool;
  let schema: string;
  let directory: string;
  let filename: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString: url, max: 2 });
    schema = `detection_script_${process.pid}_${Date.now().toString(36)}`.slice(0, 60);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: url, max: 2, options: `-c search_path=${schema}` });
    await migratePostgres(pool);

    directory = mkdtempSync(path.join(os.tmpdir(), "orbital-detection-script-"));
    filename = path.join(directory, "detection.sqlite");
    const database = new DatabaseSync(filename);
    database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    database.exec(`BEGIN IMMEDIATE;${SQLITE_DETECTION_SCHEMA_SQL}PRAGMA user_version=1;COMMIT;`);
    const events = [
      event("legacy-1", new Date(NOW).toISOString(), "Ancien événement 1"),
      event("legacy-2", new Date(NOW - 3_600_000).toISOString(), "Ancien événement 2"),
    ];
    for (const stored of events) {
      database.prepare("INSERT INTO detection_events (id, kind, anchor, last_received, payload) VALUES (?, ?, ?, ?, ?)")
        .run(stored.id, stored.kind, NOW, stored.lastReceivedAt, JSON.stringify(stored));
    }
    database.prepare("INSERT INTO detection_signals (id, event_id, digest) VALUES (?, ?, ?)").run("legacy-signal-1", "legacy-1", "d1");
    database.prepare("INSERT INTO detection_signals (id, event_id, digest) VALUES (?, ?, ?)").run("legacy-signal-2", "legacy-2", "d2");
    database.close();
  });

  afterAll(async () => {
    await pool.end().catch(() => undefined);
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => undefined);
    await admin.end();
    rmSync(directory, { recursive: true, force: true });
  });

  const run = (apply: boolean) => execFileSync(process.execPath, [script, "--sqlite", filename, ...(apply ? ["--apply"] : [])], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: withSchema(url!, schema) },
  });

  it("simule par défaut, puis copie sans supprimer la source", async () => {
    const dryRun = run(false);
    expect(dryRun).toContain("simulation");
    expect((await pool.query("SELECT count(*)::int AS n FROM detection_events")).rows[0].n).toBe(0);

    const applied = run(true);
    expect(applied).toContain("écrits : 2 événements, 2 signaux");
    expect((await pool.query("SELECT count(*)::int AS n FROM detection_events")).rows[0].n).toBe(2);
    expect((await pool.query("SELECT count(*)::int AS n FROM detection_signals")).rows[0].n).toBe(2);

    const source = new DatabaseSync(filename, { readOnly: true });
    try {
      expect((source.prepare("SELECT count(*) AS n FROM detection_events").get() as { n: number }).n).toBe(2);
      expect((source.prepare("SELECT count(*) AS n FROM detection_signals").get() as { n: number }).n).toBe(2);
    } finally {
      source.close();
    }
  });

  it("est idempotente et ne remplace pas un événement PostgreSQL plus récent", async () => {
    await pool.query("UPDATE detection_events SET last_received = $1::timestamptz, payload = jsonb_set(payload, '{title}', '\"Version PostgreSQL plus récente\"') WHERE id = 'legacy-1'", [
      new Date(NOW + 60_000).toISOString(),
    ]);
    const second = run(true);
    expect(second).toContain("écrits : 0 événements, 0 signaux");
    const row = await pool.query("SELECT payload->>'title' AS title FROM detection_events WHERE id = 'legacy-1'");
    expect(row.rows[0].title).toBe("Version PostgreSQL plus récente");
  });
});
