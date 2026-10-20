import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OrbitalEvent, SignalKind } from "@/types/detection";

export const RETENTION_MS = 7 * 86_400_000;
export interface DetectionTransaction {
  bySignal(id: string): { event: OrbitalEvent; digest: string } | null;
  candidates(kind: SignalKind, time: number, window: number): OrbitalEvent[];
  put(event: OrbitalEvent, anchor: number): void;
  remember(signalId: string, eventId: string, digest: string): void;
  recent(limit: number): OrbitalEvent[];
  purge(before: number): void;
}
export interface DetectionStore {
  transaction<Result>(work: (transaction: DetectionTransaction) => Result): Result;
  close(): void;
}

export class SqliteDetectionStore implements DetectionStore {
  private database: DatabaseSync;
  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(filename);
    this.database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    const version = Number(this.database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version > 1) { this.database.close(); throw new Error("Unsupported detection schema"); }
    this.database.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS detection_events (id TEXT PRIMARY KEY, kind TEXT NOT NULL, anchor REAL NOT NULL, last_received TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS detection_candidates ON detection_events(kind,anchor);
      CREATE INDEX IF NOT EXISTS detection_retention ON detection_events(anchor);
      CREATE INDEX IF NOT EXISTS detection_recent ON detection_events(last_received DESC,id);
      CREATE TABLE IF NOT EXISTS detection_signals (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES detection_events(id) ON DELETE CASCADE, digest TEXT NOT NULL);
      PRAGMA user_version=1; COMMIT;`);
  }
  transaction<Result>(work: (transaction: DetectionTransaction) => Result): Result {
    const database = this.database;
    const parse = (row: unknown): OrbitalEvent => JSON.parse((row as { payload: string }).payload) as OrbitalEvent;
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = work({
        bySignal: (id) => {
          const row = database.prepare("SELECT e.payload,s.digest FROM detection_signals s JOIN detection_events e ON e.id=s.event_id WHERE s.id=?").get(id);
          return row ? { event: parse(row), digest: String(row.digest) } : null;
        },
        candidates: (kind, time, window) => database.prepare("SELECT payload FROM detection_events WHERE kind=? AND anchor BETWEEN ? AND ? ORDER BY ABS(anchor-?),id LIMIT 64").all(kind, time - window, time + window, time).map(parse),
        put: (event, anchor) => { database.prepare("INSERT INTO detection_events(id,kind,anchor,last_received,payload) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,anchor=excluded.anchor,last_received=excluded.last_received,payload=excluded.payload").run(event.id, event.kind, anchor, event.lastReceivedAt, JSON.stringify(event)); },
        remember: (id, eventId, digest) => { database.prepare("INSERT INTO detection_signals(id,event_id,digest) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET event_id=excluded.event_id,digest=excluded.digest").run(id, eventId, digest); },
        recent: (limit) => database.prepare("SELECT payload FROM detection_events ORDER BY last_received DESC,id LIMIT ?").all(limit).map(parse),
        purge: (before) => { database.prepare("DELETE FROM detection_events WHERE anchor < ?").run(before); },
      });
      database.exec("COMMIT");
      return result;
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  }
  close() { this.database.close(); }
}
