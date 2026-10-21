import type { Pool, PoolClient } from "pg";

/**
 * Migrations versionnées du schéma PostgreSQL.
 *
 * Table `orbital_schema_migrations` (version, nom, date). Toutes les migrations en attente
 * sont appliquées dans UNE transaction, sous verrou consultatif (`pg_advisory_xact_lock`) :
 * plusieurs instances démarrant ensemble ne les appliquent qu'une fois. Une base au schéma
 * plus récent que l'application est refusée.
 *
 * Ajouter une migration : nouvelle entrée en fin de liste, jamais modifier une migration publiée.
 */

/** Schéma historique (v1), créé implicitement avant le versionnement. */
export const SCHEMA_SQL = `
-- Schéma PostgreSQL. Créer l'extension PostGIS est OPTIONNEL :
--   CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS conflict_events (
  id              TEXT PRIMARY KEY,
  source_dataset  TEXT        NOT NULL,
  latitude        DOUBLE PRECISION NOT NULL,
  longitude       DOUBLE PRECISION NOT NULL,
  country         TEXT        NOT NULL DEFAULT '',
  region          TEXT        NOT NULL DEFAULT '',
  locality        TEXT        NOT NULL DEFAULT '',
  event_type      TEXT        NOT NULL,
  sub_event_type  TEXT        NOT NULL DEFAULT '',
  actors          TEXT[]      NOT NULL DEFAULT '{}',
  fatalities      INTEGER     NOT NULL DEFAULT 0,
  source          TEXT        NOT NULL DEFAULT '',
  source_url      TEXT        NOT NULL DEFAULT '',
  confidence      TEXT        NOT NULL DEFAULT 'REPORTED',
  event_date      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conflict_events_date_idx    ON conflict_events (event_date);
CREATE INDEX IF NOT EXISTS conflict_events_dataset_idx ON conflict_events (source_dataset);
CREATE INDEX IF NOT EXISTS conflict_events_type_idx    ON conflict_events (event_type);
CREATE INDEX IF NOT EXISTS conflict_events_geo_idx     ON conflict_events (latitude, longitude);
CREATE INDEX IF NOT EXISTS conflict_events_country_idx ON conflict_events (country);
-- Variante PostGIS (si l'extension est présente) :
-- ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS geom geography(Point,4326);
-- CREATE INDEX IF NOT EXISTS conflict_events_geom_idx ON conflict_events USING GIST (geom);
`;

export interface PostgresMigration {
  version: number;
  name: string;
  sql: string;
}

export const POSTGRES_MIGRATIONS: PostgresMigration[] = [
  { version: 1, name: "conflict_events et index (schéma historique)", sql: SCHEMA_SQL },
  {
    version: 2,
    name: "JSON complet, code ISO3 et index source + date",
    sql: `
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE conflict_events ADD COLUMN IF NOT EXISTS country_iso3 TEXT;
CREATE INDEX IF NOT EXISTS conflict_events_dataset_date_idx ON conflict_events (source_dataset, event_date);
CREATE INDEX IF NOT EXISTS conflict_events_country_iso3_idx ON conflict_events (country_iso3);
`,
  },
  {
    version: 3,
    name: "index de fraîcheur (MAX(updated_at) des statistiques de santé)",
    sql: `CREATE INDEX IF NOT EXISTS conflict_events_updated_idx ON conflict_events (updated_at);`,
  },
];

export const POSTGRES_SCHEMA_VERSION = POSTGRES_MIGRATIONS.at(-1)!.version;

/** Clé arbitraire et stable du verrou consultatif des migrations ORBITAL. */
const MIGRATION_LOCK_KEY = 4_207_310_942;

export type PostgresMigrationReport = { from: number; to: number; applied: number[] };

export async function migratePostgres(pool: Pool, migrations: PostgresMigration[] = POSTGRES_MIGRATIONS): Promise<PostgresMigrationReport> {
  const latest = migrations.at(-1)?.version ?? 0;
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
      await client.query(`CREATE TABLE IF NOT EXISTS orbital_schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      const current = await client.query<{ v: number | null }>("SELECT MAX(version) AS v FROM orbital_schema_migrations");
      const from = Number(current.rows[0]?.v ?? 0);
      if (from > latest) {
        throw new Error(`Base PostgreSQL au schéma v${from}, plus récent que celui de cette version d'ORBITAL (v${latest}) : mise à jour de l'application requise.`);
      }
      const applied: number[] = [];
      for (const migration of migrations) {
        if (migration.version <= from) continue;
        await client.query(migration.sql);
        await client.query("INSERT INTO orbital_schema_migrations (version, name) VALUES ($1, $2)", [migration.version, migration.name]);
        applied.push(migration.version);
      }
      await client.query("COMMIT");
      return { from, to: Math.max(from, ...applied), applied };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}
