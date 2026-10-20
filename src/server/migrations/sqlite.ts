import type { DatabaseSync } from "node:sqlite";

/**
 * Migrations versionnées du schéma SQLite.
 *
 * La version courante est stockée dans `PRAGMA user_version`. Chaque migration est appliquée
 * une seule fois, dans une transaction `BEGIN IMMEDIATE` (verrou d'écriture : deux processus
 * ne l'appliquent jamais en même temps ; la version est relue sous verrou). Une base créée par
 * une version plus récente d'ORBITAL est refusée plutôt que modifiée.
 *
 * Ajouter une migration : nouvelle entrée en fin de liste, `version` = précédente + 1, jamais
 * modifier une migration déjà publiée.
 */

export const SQLITE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS conflict_events (
  id              TEXT PRIMARY KEY,
  source_dataset  TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  country         TEXT NOT NULL DEFAULT '',
  country_iso3    TEXT,
  confidence      TEXT NOT NULL,
  fatalities      INTEGER NOT NULL DEFAULT 0,
  event_date      TEXT NOT NULL,
  event_ts        INTEGER,
  lat             REAL NOT NULL,
  lon             REAL NOT NULL,
  updated_at      TEXT NOT NULL,
  payload         TEXT NOT NULL CHECK (json_valid(payload))
) STRICT;
`;

export const SQLITE_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS conflict_events_event_ts_idx
  ON conflict_events (event_ts);
CREATE INDEX IF NOT EXISTS conflict_events_dataset_event_ts_idx
  ON conflict_events (source_dataset, event_ts);
CREATE INDEX IF NOT EXISTS conflict_events_type_event_ts_idx
  ON conflict_events (event_type, event_ts);
CREATE INDEX IF NOT EXISTS conflict_events_country_event_ts_idx
  ON conflict_events (country, event_ts);
CREATE INDEX IF NOT EXISTS conflict_events_country_iso3_event_ts_idx
  ON conflict_events (country_iso3, event_ts);
CREATE INDEX IF NOT EXISTS conflict_events_geo_idx
  ON conflict_events (lat, lon);
CREATE INDEX IF NOT EXISTS conflict_events_updated_idx
  ON conflict_events (updated_at);
`;

export const SQLITE_SCHEMA_SQL = `${SQLITE_TABLE_SQL}${SQLITE_INDEX_SQL}`;

function timestampOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function ensureTimestampSchema(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info('conflict_events')").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "event_ts")) {
    database.exec("ALTER TABLE conflict_events ADD COLUMN event_ts INTEGER;");
  }
  const pending = database.prepare("SELECT id, payload FROM conflict_events WHERE event_ts IS NULL").all() as Array<{
    id: string;
    payload: string;
  }>;
  const update = database.prepare("UPDATE conflict_events SET event_ts = ? WHERE id = ?");
  for (const row of pending) {
    const payload = JSON.parse(row.payload) as { eventDate?: unknown };
    update.run(timestampOf(payload.eventDate), row.id);
  }
}

export interface SqliteMigration {
  version: number;
  name: string;
  up(database: DatabaseSync): void;
}

export const SQLITE_MIGRATIONS: SqliteMigration[] = [
  {
    version: 1,
    // Schéma historique (créé implicitement avant le versionnement) : idempotent sur une base existante.
    name: "conflict_events, horodatage event_ts et index",
    up(database) {
      database.exec(SQLITE_TABLE_SQL);
      ensureTimestampSchema(database);
      database.exec(SQLITE_INDEX_SQL);
    },
  },
];

export const SQLITE_SCHEMA_VERSION = SQLITE_MIGRATIONS.at(-1)!.version;

export type SqliteMigrationReport = { from: number; to: number; applied: number[] };

const userVersion = (database: DatabaseSync) => Number((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);

export function migrateSqlite(database: DatabaseSync, migrations: SqliteMigration[] = SQLITE_MIGRATIONS): SqliteMigrationReport {
  const latest = migrations.at(-1)?.version ?? 0;
  const from = userVersion(database);
  if (from > latest) {
    throw new Error(`Base SQLite au schéma v${from}, plus récent que celui de cette version d'ORBITAL (v${latest}) : mise à jour de l'application requise.`);
  }
  const applied: number[] = [];
  for (const migration of migrations) {
    if (migration.version <= from) continue;
    database.exec("BEGIN IMMEDIATE;");
    try {
      // Relu sous verrou : un autre processus a pu appliquer la migration entre-temps.
      if (userVersion(database) >= migration.version) {
        database.exec("COMMIT;");
        continue;
      }
      migration.up(database);
      database.exec(`PRAGMA user_version = ${migration.version};`);
      database.exec("COMMIT;");
      applied.push(migration.version);
    } catch (error) {
      database.exec("ROLLBACK;");
      throw new Error(`Migration SQLite v${migration.version} (${migration.name}) échouée`, { cause: error });
    }
  }
  return { from, to: userVersion(database), applied };
}
