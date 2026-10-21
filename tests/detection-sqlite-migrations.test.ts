import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteDetectionStore } from "@/server/detection/store";
import { event } from "./detection-store-helpers";

/** Schéma SQLite historique (v1), sans les index ajoutés par le backend partagé. */
const LEGACY_SQL = `
CREATE TABLE IF NOT EXISTS detection_events (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, anchor REAL NOT NULL,
  last_received TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS detection_candidates ON detection_events(kind,anchor);
CREATE INDEX IF NOT EXISTS detection_retention ON detection_events(anchor);
CREATE INDEX IF NOT EXISTS detection_recent ON detection_events(last_received DESC,id);
CREATE TABLE IF NOT EXISTS detection_signals (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES detection_events(id) ON DELETE CASCADE,
  digest TEXT NOT NULL
);
`;

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function legacyFile(): { directory: string; filename: string } {
  const directory = mkdtempSync(path.join(os.tmpdir(), "orbital-detection-legacy-"));
  directories.push(directory);
  const filename = path.join(directory, "detection.sqlite");
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  database.exec(`BEGIN IMMEDIATE;${LEGACY_SQL}PRAGMA user_version=1;COMMIT;`);
  const stored = event("legacy-event", new Date("2026-10-20T12:00:00Z").toISOString(), "Ancien événement");
  database.prepare("INSERT INTO detection_events (id, kind, anchor, last_received, payload) VALUES (?, ?, ?, ?, ?)")
    .run(stored.id, stored.kind, Date.parse("2026-10-20T12:00:00Z"), stored.lastReceivedAt, JSON.stringify(stored));
  database.prepare("INSERT INTO detection_signals (id, event_id, digest) VALUES (?, ?, ?)")
    .run("legacy-signal", stored.id, "legacy-digest");
  database.close();
  return { directory, filename };
}

describe("schéma SQLite de détection", () => {
  it("ouvre une base v1 existante sans migration destructive et relit ses données", async () => {
    const { filename } = legacyFile();
    const store = new SqliteDetectionStore(filename);
    try {
      const found = await store.transaction((transaction) => transaction.bySignal("legacy-signal"));
      expect(found).toMatchObject({ digest: "legacy-digest", event: { id: "legacy-event", title: "Ancien événement" } });
      const check = new DatabaseSync(filename, { readOnly: true });
      try {
        const eventIndexes = check.prepare("PRAGMA index_list('detection_events')").all().map((row) => (row as { name: string }).name);
        const signalIndexes = check.prepare("PRAGMA index_list('detection_signals')").all().map((row) => (row as { name: string }).name);
        expect(eventIndexes).toContain("detection_matching_order");
        expect(signalIndexes).toContain("detection_signals_event");
        expect((check.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(1);
      } finally {
        check.close();
      }
    } finally {
      await store.close();
    }
  });

  it("refuse un schéma plus récent que l'application", () => {
    const { filename } = legacyFile();
    const database = new DatabaseSync(filename);
    database.exec("PRAGMA user_version=2;");
    database.close();
    expect(() => new SqliteDetectionStore(filename)).toThrow(/Unsupported detection schema version 2/);
  });

  it("reste idempotent à chaque ouverture", async () => {
    const { filename } = legacyFile();
    for (let open = 0; open < 2; open++) {
      const store = new SqliteDetectionStore(filename);
      expect(await store.transaction((transaction) => transaction.recent(10))).toHaveLength(1);
      await store.close();
    }
  });
});
