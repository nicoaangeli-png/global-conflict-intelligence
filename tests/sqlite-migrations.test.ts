import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateSqlite, SQLITE_SCHEMA_VERSION } from "@/server/migrations/sqlite";
import { SqliteRepository } from "@/server/sqliteRepository";

const dirs: string[] = [];
function tempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "orbital-mig-"));
  dirs.push(dir);
  return path.join(dir, "test.sqlite");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const version = (db: DatabaseSync) => Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);

describe("migrations SQLite versionnées", () => {
  it("base neuve : schéma créé, version enregistrée, réouverture sans nouvelle migration", () => {
    const file = tempDb();
    const db = new DatabaseSync(file);
    expect(migrateSqlite(db)).toEqual({ from: 0, to: SQLITE_SCHEMA_VERSION, applied: [1] });
    expect(migrateSqlite(db)).toEqual({ from: SQLITE_SCHEMA_VERSION, to: SQLITE_SCHEMA_VERSION, applied: [] });
    db.close();
  });

  it("base historique sans version ni colonne event_ts : migrée sans perte, horodatages calculés", () => {
    const file = tempDb();
    const legacy = new DatabaseSync(file);
    legacy.exec(`CREATE TABLE conflict_events (
      id TEXT PRIMARY KEY, source_dataset TEXT NOT NULL, event_type TEXT NOT NULL, country TEXT NOT NULL DEFAULT '',
      country_iso3 TEXT, confidence TEXT NOT NULL, fatalities INTEGER NOT NULL DEFAULT 0, event_date TEXT NOT NULL,
      lat REAL NOT NULL, lon REAL NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL CHECK (json_valid(payload))) STRICT;`);
    legacy.prepare("INSERT INTO conflict_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "ucdp-1", "ucdp", "Battles", "Sudan", "SDN", "VERIFIED", 3, "2026-08-01T12:00:00.000Z", 15.5, 32.5, "2026-08-02T00:00:00.000Z",
      JSON.stringify({ id: "ucdp-1", eventDate: "2026-08-01T12:00:00.000Z" }),
    );
    expect(migrateSqlite(legacy)).toMatchObject({ from: 0, applied: [1] });
    expect(legacy.prepare("SELECT event_ts FROM conflict_events WHERE id = 'ucdp-1'").get()).toEqual({ event_ts: Date.parse("2026-08-01T12:00:00.000Z") });
    expect(version(legacy)).toBe(SQLITE_SCHEMA_VERSION);
    legacy.close();
  });

  it("refuse une base au schéma plus récent que l'application", () => {
    const db = new DatabaseSync(tempDb());
    db.exec(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION + 1};`);
    expect(() => migrateSqlite(db)).toThrow(/plus récent/);
    db.close();
  });

  it("migration en échec : annulée entièrement, version inchangée", () => {
    const db = new DatabaseSync(tempDb());
    const broken = [{ version: 1, name: "cassée", up: (database: DatabaseSync) => { database.exec("CREATE TABLE t (x INTEGER);"); database.exec("SYNTAX ERROR"); } }];
    expect(() => migrateSqlite(db, broken)).toThrow(/Migration SQLite v1/);
    expect(version(db)).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 't'").get()).toBeUndefined();
    db.close();
  });

  it("dépôt : expose version du schéma et contrôle d'intégrité", async () => {
    const repository = new SqliteRepository(tempDb(), { initialJsonPath: undefined });
    await repository.init();
    expect(repository.diagnostics()).toMatchObject({ schemaVersion: SQLITE_SCHEMA_VERSION, integrity: "ok" });
    repository.close();
  });
});

describe("arrêt brutal", () => {
  it("processus tué en pleine transaction : données validées conservées, transaction en cours annulée, base intègre", () => {
    const file = tempDb();
    const script = `
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(${JSON.stringify(file)});
      db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)");
      const insert = db.prepare("INSERT INTO t (v) VALUES (?)");
      db.exec("BEGIN"); for (let i = 0; i < 1000; i++) insert.run("validé " + i); db.exec("COMMIT");
      db.exec("BEGIN"); for (let i = 0; i < 1000; i++) insert.run("non validé " + i);
      process.kill(process.pid, "SIGKILL");
    `;
    const child = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    expect(child.signal).toBe("SIGKILL");
    const db = new DatabaseSync(file);
    expect(db.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM t").get()).toEqual({ n: 1000 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM t WHERE v LIKE 'non validé%'").get()).toEqual({ n: 0 });
    db.close();
  });
});
