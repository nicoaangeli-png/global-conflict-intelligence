import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OrbitalEvent, SignalKind } from "@/types/detection";
import { MAX_CANDIDATES } from "./limits";

export const RETENTION_MS = 7 * 86_400_000;

/** Version du schéma SQLite de détection (PRAGMA user_version de data/detection.sqlite). */
export const SQLITE_DETECTION_SCHEMA_VERSION = 1;

/**
 * Transaction de détection, indépendante du backend.
 *
 * Toutes les méthodes sont asynchrones : SQLite répond en mémoire, PostgreSQL fait un
 * aller-retour réseau. Le moteur ne connaît que cette interface et ne duplique aucune
 * logique métier entre les deux implémentations.
 *
 * La création exclusive, la mise à jour existante et la mise à jour optimiste d'un
 * snapshot sont séparées : aucune collision ou course de suppression ne devient un UPSERT.
 * `lock` sérialise les écritures qui peuvent se disputer un même cluster. SQLite est
 * déjà sérialisé par `BEGIN IMMEDIATE` ; PostgreSQL prend un verrou consultatif par
 * catégorie de signal, dans un ordre global stable.
 */
export interface DetectionTransaction {
  bySignal(id: string): Promise<{ event: OrbitalEvent; digest: string } | null>;
  eventById(id: string): Promise<OrbitalEvent | null>;
  candidates(kind: SignalKind, time: number, window: number): Promise<OrbitalEvent[]>;
  createEventExclusive(event: OrbitalEvent, anchor: number): Promise<boolean>;
  updateEvent(event: OrbitalEvent, anchor: number): Promise<boolean>;
  updateEventIfExists(event: OrbitalEvent, anchor: number, expected: OrbitalEvent): Promise<boolean>;
  removeEvent(id: string): Promise<void>;
  forget(signalId: string): Promise<void>;
  remember(signalId: string, eventId: string, digest: string): Promise<void>;
  signalCountForEvent(eventId: string): Promise<number>;
  recent(limit: number): Promise<OrbitalEvent[]>;
  purge(before: number): Promise<void>;
  lockSignals(ids: readonly string[]): Promise<void>;
  lock(kinds: readonly SignalKind[]): Promise<void>;
}

export interface DetectionStore {
  readonly kind: "sqlite" | "postgres";
  transaction<Result>(work: (transaction: DetectionTransaction) => Promise<Result>): Promise<Result>;
  close(): Promise<void>;
}

/** Schéma SQLite, identique au schéma historique v1 (aucune migration destructive). */
export const SQLITE_DETECTION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS detection_events (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  anchor        REAL NOT NULL,
  last_received TEXT NOT NULL,
  payload       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS detection_candidates ON detection_events (kind, anchor);
CREATE INDEX IF NOT EXISTS detection_matching_order ON detection_events (kind, anchor, id);
CREATE INDEX IF NOT EXISTS detection_retention ON detection_events (anchor);
CREATE INDEX IF NOT EXISTS detection_recent ON detection_events (last_received DESC, id);
CREATE TABLE IF NOT EXISTS detection_signals (
  id       TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES detection_events(id) ON DELETE CASCADE,
  digest   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS detection_signals_event ON detection_signals (event_id);
`;

export class SqliteDetectionStore implements DetectionStore {
  readonly kind = "sqlite" as const;
  private database: DatabaseSync;
  /** SQLite n'a qu'une connexion : les transactions d'un même processus sont sérialisées. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(filename);
    try {
      this.database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
      const version = Number(this.database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
      if (version > SQLITE_DETECTION_SCHEMA_VERSION) {
        throw new Error(`Unsupported detection schema version ${version}; this build supports version ${SQLITE_DETECTION_SCHEMA_VERSION}`);
      }
      this.database.exec(`BEGIN IMMEDIATE;${SQLITE_DETECTION_SCHEMA_SQL}PRAGMA user_version=${SQLITE_DETECTION_SCHEMA_VERSION};COMMIT;`);
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  transaction<Result>(work: (transaction: DetectionTransaction) => Promise<Result>): Promise<Result> {
    const run = this.queue.then(() => this.execute(work));
    // La file ne doit jamais rester bloquée sur une transaction en échec.
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async execute<Result>(work: (transaction: DetectionTransaction) => Promise<Result>): Promise<Result> {
    const database = this.database;
    const parse = (row: unknown): OrbitalEvent => JSON.parse((row as { payload: string }).payload) as OrbitalEvent;
    const query = <Row>(sql: string, ...parameters: (string | number)[]): Row[] => database.prepare(sql).all(...parameters) as Row[];
    const one = <Row>(sql: string, ...parameters: (string | number)[]): Row | undefined => database.prepare(sql).get(...parameters) as Row | undefined;

    // Hors du try : si BEGIN échoue (fichier verrouillé), il n'y a rien à annuler et
    // un ROLLBACK masquerait l'erreur d'origine.
    database.exec("BEGIN IMMEDIATE");
    try {
      const transaction: DetectionTransaction = {
        async lockSignals() {
          // BEGIN IMMEDIATE sérialise déjà toutes les écritures du fichier.
        },
        async lock() {
          // BEGIN IMMEDIATE a déjà le verrou d'écriture exclusif du fichier.
        },
        async bySignal(id) {
          const row = one<{ payload: string; digest: string }>(
            "SELECT e.payload, s.digest FROM detection_signals s JOIN detection_events e ON e.id = s.event_id WHERE s.id = ?",
            id,
          );
          return row ? { event: parse(row), digest: String(row.digest) } : null;
        },
        async eventById(id) {
          const row = one<{ payload: string }>("SELECT payload FROM detection_events WHERE id = ?", id);
          return row ? parse(row) : null;
        },
        async candidates(kind, time, window) {
          // Deux bornes indexées (avant/après) puis tri exact par distance : évite de
          // perdre les candidats les plus proches dans un grand intervalle.
          const before = query<{ payload: string; anchor: number; id: string }>(
            "SELECT payload, anchor, id FROM detection_events WHERE kind = ? AND anchor BETWEEN ? AND ? ORDER BY anchor DESC, id DESC LIMIT ?",
            kind, time - window, time, MAX_CANDIDATES,
          );
          const after = query<{ payload: string; anchor: number; id: string }>(
            "SELECT payload, anchor, id FROM detection_events WHERE kind = ? AND anchor > ? AND anchor <= ? ORDER BY anchor, id LIMIT ?",
            kind, time, time + window, MAX_CANDIDATES,
          );
          return [...before, ...after]
            .sort((first, second) => Math.abs(Number(first.anchor) - time) - Math.abs(Number(second.anchor) - time) || first.id.localeCompare(second.id))
            .slice(0, MAX_CANDIDATES)
            .map(parse);
        },
        async createEventExclusive(event, anchor) {
          const result = database.prepare(
            "INSERT INTO detection_events (id, kind, anchor, last_received, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
          ).run(event.id, event.kind, anchor, event.lastReceivedAt, JSON.stringify(event));
          return result.changes === 1;
        },
        async updateEvent(event, anchor) {
          const result = database.prepare(
            `UPDATE detection_events
                SET kind = ?, anchor = ?, last_received = ?, payload = ?
              WHERE id = ? AND last_received <= ?`,
          ).run(event.kind, anchor, event.lastReceivedAt, JSON.stringify(event), event.id, event.lastReceivedAt);
          return result.changes === 1;
        },
        async updateEventIfExists(event, anchor, expected) {
          const result = database.prepare(
            `UPDATE detection_events
                SET kind = ?, anchor = ?, last_received = ?, payload = ?
              WHERE id = ? AND last_received = ? AND payload = ?`,
          ).run(event.kind, anchor, event.lastReceivedAt, JSON.stringify(event), event.id, expected.lastReceivedAt, JSON.stringify(expected));
          return result.changes === 1;
        },
        async removeEvent(id) {
          database.prepare("DELETE FROM detection_events WHERE id = ?").run(id);
        },
        async forget(id) {
          database.prepare("DELETE FROM detection_signals WHERE id = ?").run(id);
        },
        async remember(id, eventId, digest) {
          database.prepare(
            `INSERT INTO detection_signals (id, event_id, digest) VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET event_id = excluded.event_id, digest = excluded.digest`,
          ).run(id, eventId, digest);
        },
        async signalCountForEvent(eventId) {
          return Number(one<{ count: number }>("SELECT COUNT(*) AS count FROM detection_signals WHERE event_id = ?", eventId)?.count ?? 0);
        },
        async recent(limit) {
          return query<{ payload: string }>("SELECT payload FROM detection_events ORDER BY last_received DESC, id LIMIT ?", limit).map(parse);
        },
        async purge(before) {
          database.prepare("DELETE FROM detection_events WHERE anchor < ?").run(before);
        },
      };
      const result = await work(transaction);
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  async close() {
    await this.queue.catch(() => undefined);
    this.database.close();
  }
}
