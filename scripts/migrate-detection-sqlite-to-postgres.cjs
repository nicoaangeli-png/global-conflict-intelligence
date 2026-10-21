#!/usr/bin/env node
/**
 * Migration VOLONTAIRE des données de détection SQLite vers PostgreSQL.
 *
 * - Par défaut : simulation (aucune écriture), comptages et conflits.
 * - `--apply` : copie dans une transaction, sans jamais supprimer ni modifier SQLite.
 * - Les événements PostgreSQL plus récents (`last_received`) ne sont pas écrasés.
 * - Les signaux déjà présents dans PostgreSQL ne sont pas remappés.
 *
 * Prérequis : le schéma PostgreSQL doit déjà être en v4 (démarrer l'application une
 * fois avec DATABASE_URL, ou appliquer les migrations par le chemin habituel).
 *
 * Usage :
 *   DATABASE_URL=postgresql://… node scripts/migrate-detection-sqlite-to-postgres.cjs
 *   DATABASE_URL=postgresql://… node scripts/migrate-detection-sqlite-to-postgres.cjs --apply
 *   … --sqlite data/detection.sqlite
 */
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const sqliteIndex = args.indexOf("--sqlite");
const sqlitePath = path.resolve(sqliteIndex >= 0 ? args[sqliteIndex + 1] : process.env.ORBITAL_DETECTION_PATH ?? path.join(process.cwd(), "data", "detection.sqlite"));
const databaseUrl = process.env.DATABASE_URL?.trim();
const REQUIRED_SCHEMA_VERSION = 4;
const MIGRATION_LOCK_KEY = 4_207_310_942;

function redact(text) {
  let out = String(text ?? "");
  if (databaseUrl) out = out.split(databaseUrl).join("[DATABASE_URL]");
  return out.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[postgresql://…]");
}

function fail(message) {
  console.error(`[migration détection] ${redact(message)}`);
  process.exit(1);
}

function readSource() {
  let database;
  try {
    database = new DatabaseSync(sqlitePath, { readOnly: true });
  } catch (error) {
    fail(`Ouverture SQLite impossible (${sqlitePath}) : ${error.message}`);
  }
  try {
    const version = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version > 1) fail(`Schéma SQLite de détection v${version} inconnu (maximum pris en charge : v1).`);
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('detection_events','detection_signals')").all().map((row) => row.name);
    if (!tables.includes("detection_events") || !tables.includes("detection_signals")) {
      fail("Tables de détection absentes de la base SQLite indiquée.");
    }
    const events = database.prepare("SELECT id, kind, anchor, last_received, payload FROM detection_events ORDER BY id").all();
    const signals = database.prepare("SELECT id, event_id, digest FROM detection_signals ORDER BY id").all();
    const eventIds = new Set(events.map((row) => row.id));
    for (const event of events) {
      let payload;
      try { payload = JSON.parse(event.payload); } catch { fail(`Payload JSON invalide pour l'événement ${event.id}.`); }
      if (!payload || typeof payload !== "object" || payload.id !== event.id) {
        fail(`Payload incohérent pour l'événement ${event.id} (id interne différent).`);
      }
      if (!Number.isFinite(Number(event.anchor)) || !Number.isFinite(Date.parse(event.last_received))) {
        fail(`Ancrage ou last_received invalide pour l'événement ${event.id}.`);
      }
    }
    for (const signal of signals) {
      if (!eventIds.has(signal.event_id)) fail(`Signal ${signal.id} rattaché à un événement absent (${signal.event_id}).`);
    }
    return { events, signals };
  } finally {
    database.close();
  }
}

async function main() {
  if (!databaseUrl) fail("DATABASE_URL est requis. Aucune valeur n'est affichée.");
  const source = readSource();
  console.log(`[migration détection] source ${sqlitePath} : ${source.events.length} événements, ${source.signals.length} signaux`);
  if (apply) console.log("[migration détection] mode APPLIQUÉ (SQLite restera intact)");
  else console.log("[migration détection] simulation ; ajouter --apply pour écrire");

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5_000, application_name: "orbital-detection-migration" });
  let client;
  try {
    client = await pool.connect();
    let began = false;
    try {
      if (apply) {
        await client.query("BEGIN");
        began = true;
        // Même verrou que les migrations : aucun démarrage concurrent ne peut modifier
        // le schéma ni copier les mêmes lignes pendant l'opération.
        await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
        await client.query("SET LOCAL statement_timeout = '120s'");
      }
      const version = await client.query("SELECT to_regclass('orbital_schema_migrations') AS migrations, to_regclass('detection_events') AS events, to_regclass('detection_signals') AS signals");
      if (!version.rows[0].migrations || !version.rows[0].events || !version.rows[0].signals) {
        fail("Schéma PostgreSQL de détection absent : démarrer d'abord l'application avec DATABASE_URL pour appliquer les migrations.");
      }
      const schema = await client.query("SELECT MAX(version) AS v FROM orbital_schema_migrations");
      const current = Number(schema.rows[0]?.v ?? 0);
      if (current < REQUIRED_SCHEMA_VERSION) {
        fail(`Schéma PostgreSQL v${current} : la migration v${REQUIRED_SCHEMA_VERSION} doit être appliquée avant la copie.`);
      }

      const existingEvents = await countExisting(client, "detection_events", source.events.map((row) => row.id));
      const existingSignals = await countExisting(client, "detection_signals", source.signals.map((row) => row.id));
      console.log(`[migration détection] déjà présents dans PostgreSQL : ${existingEvents}/${source.events.length} événements, ${existingSignals}/${source.signals.length} signaux`);

      if (!apply) {
        console.log("[migration détection] simulation terminée, aucune écriture.");
        return;
      }

      let copiedEvents = 0;
      for (const chunk of chunks(source.events, 400)) {
        const values = [];
        const tuples = chunk.map((row, index) => {
          const base = index * 5;
          values.push(row.id, row.kind, Number(row.anchor), row.last_received, row.payload);
          return `($${base + 1}, $${base + 2}, $${base + 3}::double precision, $${base + 4}::timestamptz, $${base + 5}::jsonb)`;
        });
        const result = await client.query(
          `INSERT INTO detection_events (id, kind, anchor, last_received, payload)
           VALUES ${tuples.join(",")}
           ON CONFLICT (id) DO UPDATE SET
             kind = EXCLUDED.kind, anchor = EXCLUDED.anchor,
             last_received = EXCLUDED.last_received, payload = EXCLUDED.payload,
             updated_at = now()
           WHERE EXCLUDED.last_received > detection_events.last_received`,
          values,
        );
        copiedEvents += result.rowCount ?? 0;
      }
      let copiedSignals = 0;
      for (const chunk of chunks(source.signals, 800)) {
        const values = [];
        const tuples = chunk.map((row, index) => {
          const base = index * 3;
          values.push(row.id, row.event_id, row.digest);
          return `($${base + 1}, $${base + 2}, $${base + 3})`;
        });
        const result = await client.query(
          `INSERT INTO detection_signals (id, event_id, digest)
           VALUES ${tuples.join(",")}
           ON CONFLICT (id) DO NOTHING`,
          values,
        );
        copiedSignals += result.rowCount ?? 0;
      }
      await client.query("COMMIT");
      began = false;
      console.log(`[migration détection] écrits : ${copiedEvents} événements, ${copiedSignals} signaux (les conflits plus récents sont conservés).`);
      console.log("[migration détection] SQLite n'a pas été modifié. Vérifier /api/detection avant de changer ORBITAL_DETECTION_STORAGE.");
    } catch (error) {
      if (began) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    client?.release();
    await pool.end().catch(() => undefined);
  }
}

async function countExisting(client, table, ids) {
  let count = 0;
  for (const chunk of chunks(ids, 1000)) {
    const result = await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE id = ANY($1::text[])`, [chunk]);
    count += Number(result.rows[0]?.n ?? 0);
  }
  return count;
}

function* chunks(items, size) {
  for (let index = 0; index < items.length; index += size) yield items.slice(index, index + size);
}

main().catch((error) => fail(error?.message ?? error));
