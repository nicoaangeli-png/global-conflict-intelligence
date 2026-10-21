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

/**
 * Schéma du moteur de détection (migration v4).
 *
 * Les événements ne sont pas dédupliqués par une contrainte métier : le rapprochement
 * (catégorie, temps, lieu, texte) reste dans `engine.ts`. Les contraintes garantissent
 * l'unicité technique : un identifiant d'événement et un identifiant de signal sont
 * uniques, un signal pointe vers un seul événement et disparaît avec lui.
 *
 * `anchor` est l'epoch millisecondes de la plus ancienne preuve : il sert à la fenêtre
 * de candidats et à la rétention. `last_received` reste un TIMESTAMPTZ pour un tri
 * et une comparaison corrects entre instances.
 */
export const DETECTION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS detection_events (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  anchor        DOUBLE PRECISION NOT NULL,
  last_received TIMESTAMPTZ NOT NULL,
  payload       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Candidats : balayage borné par catégorie puis intervalle d'ancrage.
CREATE INDEX IF NOT EXISTS detection_candidates ON detection_events (kind, anchor);
-- Ordre stable identique à SQLite (anchor, id) pour les deux bornes de la fenêtre.
CREATE INDEX IF NOT EXISTS detection_matching_order ON detection_events (kind, anchor, id);
-- Rétention : suppression par ancienneté d'ancrage.
CREATE INDEX IF NOT EXISTS detection_retention ON detection_events (anchor);
-- Instantané : les 200 événements les plus récemment reçus.
CREATE INDEX IF NOT EXISTS detection_recent ON detection_events (last_received DESC, id);
CREATE TABLE IF NOT EXISTS detection_signals (
  id       TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES detection_events(id) ON DELETE CASCADE,
  digest   TEXT NOT NULL
);
-- PostgreSQL n'indexe pas automatiquement la colonne référencée d'une clé étrangère :
-- sans cet index, chaque purge ferait un balayage complet des signaux.
CREATE INDEX IF NOT EXISTS detection_signals_event ON detection_signals (event_id);
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
  {
    version: 4,
    name: "moteur de détection : événements, signaux, candidats et rétention",
    sql: DETECTION_SCHEMA_SQL,
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
