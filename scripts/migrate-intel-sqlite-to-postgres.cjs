#!/usr/bin/env node
/** Offline, explicit migration of the main ORBITAL event store. No schema changes. */
const { createHash } = require("node:crypto");
const { existsSync, lstatSync } = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { Pool } = require("pg");

const SCHEMA_VERSION = 5;
const SQLITE_VERSION = 1;
const MIGRATION_LOCK_KEY = 4_207_310_942;
const BATCH_SIZE = 200;
const SOURCE_SQL = `SELECT id, source_dataset, event_type, country, country_iso3,
  confidence, fatalities, event_date, event_ts, lat, lon, updated_at, payload
  FROM conflict_events ORDER BY id`;
const TARGET_SQL = `SELECT id, source_dataset, latitude, longitude, country, region,
  locality, event_type, sub_event_type, actors, fatalities, source, source_url,
  confidence, event_date, updated_at, country_iso3, payload
  FROM conflict_events WHERE id = ANY($1::text[])`;
const REQUIRED_COLUMNS = ["id", "source_dataset", "event_type", "country", "country_iso3",
  "confidence", "fatalities", "event_date", "event_ts", "lat", "lon", "updated_at", "payload"];

class MigrationError extends Error {
  constructor(code, detail) { super(detail); this.code = code; }
}

function argsOf(argv) {
  const options = { apply: false, source: null, expectedDatabase: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--source" || arg === "--expect-database") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new MigrationError("ARGUMENT", `Missing value for ${arg}`);
      if (arg === "--source") options.source = path.resolve(value);
      else options.expectedDatabase = value;
    } else throw new MigrationError("ARGUMENT", "Unknown option");
  }
  if (!options.source || !options.expectedDatabase) {
    throw new MigrationError("ARGUMENT", "--source and --expect-database are required");
  }
  return options;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}
const canonical = (value) => JSON.stringify(stable(value));
const sha = () => createHash("sha256");
const iso = (value, field, index) => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new MigrationError("INVALID_SOURCE_ROW", `Row ${index}: invalid ${field}`);
  }
  const normalized = new Date(value).toISOString();
  if (value !== normalized) {
    throw new MigrationError("INVALID_SOURCE_ROW", `Row ${index}: non-canonical ${field}`);
  }
  return normalized;
};
const isString = (value) => typeof value === "string";

function expectedFromRow(row, index) {
  let payload;
  try { payload = JSON.parse(row.payload); }
  catch { throw new MigrationError("INVALID_SOURCE_ROW", `Row ${index}: invalid payload JSON`); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new MigrationError("INVALID_SOURCE_ROW", `Row ${index}: payload must be an object`);
  }
  for (const field of ["id", "sourceDataset", "eventType", "country", "region", "locality",
    "subEventType", "source", "sourceUrl", "confidence", "eventDate", "updatedAt"]) {
    if (!isString(payload[field])) throw new MigrationError("INVALID_SOURCE_ROW", `Row ${index}: invalid ${field}`);
  }
  if (!payload.id || !payload.sourceDataset || !payload.eventType || !payload.confidence) {
    throw new MigrationError("INVALID_SOURCE_ROW", `Row ${index}: empty required field`);
  }
  if (!Array.isArray(payload.actors) || !payload.actors.every(isString)) {
    throw new MigrationError("INVALID_SOURCE_ROW", `Row ${index}: invalid actors`);
  }
  if (!Number.isFinite(payload.latitude) || !Number.isFinite(payload.longitude) ||
      !Number.isSafeInteger(payload.fatalities) || payload.fatalities < -2147483648 || payload.fatalities > 2147483647) {
    throw new MigrationError("INVALID_SOURCE_ROW", `Row ${index}: invalid numeric value`);
  }
  const eventDate = iso(payload.eventDate, "eventDate", index);
  const updatedAt = iso(payload.updatedAt, "updatedAt", index);
  const matches = row.id === payload.id && row.source_dataset === payload.sourceDataset &&
    row.event_type === payload.eventType && row.country === payload.country &&
    row.confidence === payload.confidence && row.fatalities === payload.fatalities &&
    row.event_date === payload.eventDate && row.updated_at === payload.updatedAt &&
    row.lat === payload.latitude && row.lon === payload.longitude &&
    (row.event_ts === null || row.event_ts === Date.parse(eventDate));
  if (!matches) throw new MigrationError("INVALID_SOURCE_ROW", `Row ${index}: columns differ from payload`);
  if (row.country_iso3 !== null && (typeof row.country_iso3 !== "string" || !/^[A-Z]{3}$/.test(row.country_iso3))) {
    throw new MigrationError("INVALID_SOURCE_ROW", `Row ${index}: invalid country_iso3`);
  }
  return {
    id: payload.id, source_dataset: payload.sourceDataset,
    latitude: payload.latitude, longitude: payload.longitude, country: payload.country,
    region: payload.region, locality: payload.locality, event_type: payload.eventType,
    sub_event_type: payload.subEventType, actors: payload.actors,
    fatalities: payload.fatalities, source: payload.source, source_url: payload.sourceUrl,
    confidence: payload.confidence, event_date: eventDate, updated_at: updatedAt,
    country_iso3: row.country_iso3, payload,
  };
}

function* sourceRows(db) {
  let index = 0;
  for (const row of db.prepare(SOURCE_SQL).iterate()) yield expectedFromRow(row, ++index);
}

function* batches(iterable, size = BATCH_SIZE) {
  let batch = [];
  for (const item of iterable) {
    batch.push(item);
    if (batch.length === size) { yield batch; batch = []; }
  }
  if (batch.length) yield batch;
}

function actualFromRow(row) {
  return {
    id: row.id, source_dataset: row.source_dataset,
    latitude: row.latitude, longitude: row.longitude, country: row.country,
    region: row.region, locality: row.locality, event_type: row.event_type,
    sub_event_type: row.sub_event_type, actors: row.actors,
    fatalities: row.fatalities, source: row.source, source_url: row.source_url,
    confidence: row.confidence, event_date: new Date(row.event_date).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(), country_iso3: row.country_iso3,
    payload: row.payload,
  };
}

async function targetRows(client, batch) {
  const result = await client.query(TARGET_SQL, [batch.map((row) => row.id)]);
  return new Map(result.rows.map((row) => [row.id, actualFromRow(row)]));
}

async function schemaCheck(client, expectedDatabase) {
  const target = await client.query("SELECT current_database() AS database, current_schema() AS schema");
  if (target.rows[0].database !== expectedDatabase) throw new MigrationError("WRONG_DESTINATION", "Destination database name differs from --expect-database");
  const tables = await client.query("SELECT to_regclass('orbital_schema_migrations') AS migrations, to_regclass('conflict_events') AS events");
  if (!tables.rows[0].migrations || !tables.rows[0].events) throw new MigrationError("INCOMPATIBLE_SCHEMA", "PostgreSQL schema is not initialized");
  const version = await client.query("SELECT MAX(version) AS version FROM orbital_schema_migrations");
  if (Number(version.rows[0].version ?? 0) !== SCHEMA_VERSION) {
    throw new MigrationError("INCOMPATIBLE_SCHEMA", `PostgreSQL schema must be v${SCHEMA_VERSION}`);
  }
  const columns = await client.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'conflict_events'`);
  const names = new Set(columns.rows.map((row) => row.column_name));
  for (const field of ["id", "source_dataset", "latitude", "longitude", "country", "region",
    "locality", "event_type", "sub_event_type", "actors", "fatalities", "source", "source_url",
    "confidence", "event_date", "updated_at", "country_iso3", "payload"]) {
    if (!names.has(field)) throw new MigrationError("INCOMPATIBLE_SCHEMA", `Missing destination column ${field}`);
  }
  return target.rows[0].schema;
}

function sourceCheck(source, apply) {
  if (!existsSync(source) || !lstatSync(source).isFile()) throw new MigrationError("INVALID_SOURCE", "SQLite source must be an existing regular file");
  if (apply && (existsSync(`${source}-wal`) || existsSync(`${source}-shm`))) {
    throw new MigrationError("INVALID_SOURCE", "Apply requires a clean SQLite snapshot without WAL/SHM sidecars");
  }
  let db;
  try { db = new DatabaseSync(source, { readOnly: true, timeout: 30_000 }); }
  catch { throw new MigrationError("INVALID_SOURCE", "SQLite source cannot be opened safely"); }
  try {
    db.exec("BEGIN");
    const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
    if (integrity !== "ok") throw new MigrationError("INVALID_SOURCE", "SQLite integrity_check failed");
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? -1);
    if (version !== SQLITE_VERSION) throw new MigrationError("INCOMPATIBLE_SCHEMA", `SQLite schema must be v${SQLITE_VERSION}`);
    const columns = new Set(db.prepare("PRAGMA table_info(conflict_events)").all().map((row) => row.name));
    for (const field of REQUIRED_COLUMNS) {
      if (!columns.has(field)) throw new MigrationError("INCOMPATIBLE_SCHEMA", `Missing source column ${field}`);
    }
    return db;
  } catch (error) { db.close(); throw error; }
}

function sourceSummary(db, report) {
  const digest = sha();
  const bySource = {};
  const byCategory = {};
  const byMonth = {};
  let count = 0;
  for (const raw of db.prepare(SOURCE_SQL).iterate()) {
    count++;
    let row;
    try { row = expectedFromRow(raw, count); }
    catch (error) {
      report.rejected++;
      if (report.errors.length < 10) report.errors.push({ code: "INVALID_SOURCE_ROW", detail: error.message });
      continue;
    }
    digest.update(canonical(row) + "\n");
    bySource[row.source_dataset] = (bySource[row.source_dataset] ?? 0) + 1;
    byCategory[row.event_type] = (byCategory[row.event_type] ?? 0) + 1;
    const month = row.event_date.slice(0, 7);
    byMonth[month] = (byMonth[month] ?? 0) + 1;
  }
  report.sqliteCount = count;
  report.sourceChecksum = digest.digest("hex");
  report.dimensions = { bySource, byCategory, byMonth };
  if (report.rejected) throw new MigrationError("INVALID_SOURCE", `${report.rejected} invalid SQLite row(s); no data was changed`);
}

async function inspectTarget(client, db, report) {
  const result = await client.query("SELECT COUNT(*)::int AS count FROM conflict_events");
  report.postgresBefore = Number(result.rows[0].count);
  let present = 0;
  let collisions = 0;
  for (const batch of batches(sourceRows(db))) {
    const found = await targetRows(client, batch);
    for (const expected of batch) {
      const actual = found.get(expected.id);
      if (!actual) continue;
      if (canonical(actual) === canonical(expected)) present++;
      else collisions++;
    }
  }
  report.alreadyPresent = present;
  report.collisions = collisions;
  report.destinationExtras = report.postgresBefore - present - collisions;
  if (collisions || report.destinationExtras) {
    throw new MigrationError("DESTINATION_CONFLICT", "Destination has differing IDs or extra rows; no data was changed");
  }
}

async function insertMissing(client, db) {
  let inserted = 0;
  const columns = ["id", "source_dataset", "latitude", "longitude", "country", "region", "locality",
    "event_type", "sub_event_type", "actors", "fatalities", "source", "source_url", "confidence",
    "event_date", "updated_at", "country_iso3", "payload"];
  for (const batch of batches(sourceRows(db))) {
    const found = await targetRows(client, batch);
    const missing = batch.filter((row) => !found.has(row.id));
    if (!missing.length) continue;
    const values = [];
    const tuples = missing.map((row) => {
      const start = values.length;
      for (const column of columns) values.push(column === "payload" ? JSON.stringify(row.payload) : row[column]);
      const slots = columns.map((_, index) => `$${start + index + 1}${index === 17 ? "::jsonb" : ""}`);
      return `(${slots.join(",")})`;
    });
    const result = await client.query(`INSERT INTO conflict_events (${columns.join(",")})
      VALUES ${tuples.join(",")} ON CONFLICT (id) DO NOTHING`, values);
    if (result.rowCount !== missing.length) throw new MigrationError("CONCURRENT_COLLISION", "An ID changed during the migration");
    inserted += result.rowCount;
  }
  return inserted;
}

async function verifyTarget(client, db, expectedCount, expectedChecksum, dimensions) {
  const count = Number((await client.query("SELECT COUNT(*)::int AS count FROM conflict_events")).rows[0].count);
  if (count !== expectedCount) throw new MigrationError("VERIFY_FAILED", "Destination row count differs from source");
  const digest = sha();
  for (const batch of batches(sourceRows(db))) {
    const found = await targetRows(client, batch);
    for (const expected of batch) {
      const actual = found.get(expected.id);
      if (!actual || canonical(actual) !== canonical(expected)) {
        throw new MigrationError("VERIFY_FAILED", "Destination field-level comparison failed");
      }
      digest.update(canonical(actual) + "\n");
    }
  }
  const checksum = digest.digest("hex");
  if (checksum !== expectedChecksum) throw new MigrationError("VERIFY_FAILED", "Destination checksum differs from source");
  const groups = async (column) => {
    const query = column === "month"
      ? "SELECT to_char(event_date AT TIME ZONE 'UTC', 'YYYY-MM') AS key, COUNT(*)::int AS n FROM conflict_events GROUP BY 1"
      : `SELECT ${column} AS key, COUNT(*)::int AS n FROM conflict_events GROUP BY 1`;
    return Object.fromEntries((await client.query(query)).rows.map((row) => [row.key, Number(row.n)]));
  };
  const actualDimensions = {
    bySource: await groups("source_dataset"),
    byCategory: await groups("event_type"),
    byMonth: await groups("month"),
  };
  if (canonical(actualDimensions) !== canonical(dimensions)) {
    throw new MigrationError("VERIFY_FAILED", "Destination source/category/month counts differ");
  }
  return { count, checksum, fieldComparison: true, dimensions: actualDimensions };
}

async function main() {
  const started = Date.now();
  const rssBefore = process.memoryUsage().rss;
  const report = { version: 1, mode: "dry-run", source: null, destination: null,
    sqliteCount: 0, postgresBefore: null, postgresAfter: null, migrated: 0, alreadyPresent: 0,
    rejected: 0, collisions: 0, destinationExtras: 0, sourceChecksum: null,
    verification: null, committed: false, errors: [], durationMs: 0, rssDeltaBytes: 0 };
  let db;
  let pool;
  let client;
  let transactionOpen = false;
  try {
    const options = argsOf(process.argv.slice(2));
    report.mode = options.apply ? "apply" : "dry-run";
    report.source = options.source;
    const url = process.env.ORBITAL_MIGRATION_DATABASE_URL?.trim();
    if (!url) throw new MigrationError("DESTINATION_REQUIRED", "ORBITAL_MIGRATION_DATABASE_URL is required");
    report.destination = createHash("sha256").update(url).digest("hex").slice(0, 16);
    db = sourceCheck(options.source, options.apply);
    sourceSummary(db, report);
    pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5_000,
      application_name: "orbital-intel-store-migration" });
    client = await pool.connect();
    if (options.apply) {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
      await client.query("LOCK TABLE conflict_events IN SHARE ROW EXCLUSIVE MODE");
    } else {
      await client.query("BEGIN READ ONLY");
      transactionOpen = true;
    }
    await schemaCheck(client, options.expectedDatabase);
    await inspectTarget(client, db, report);
    if (options.apply) {
      report.migrated = await insertMissing(client, db);
      report.verification = await verifyTarget(client, db, report.sqliteCount, report.sourceChecksum, report.dimensions);
      await client.query("COMMIT");
      transactionOpen = false;
      report.committed = true;
      report.verification = await verifyTarget(client, db, report.sqliteCount, report.sourceChecksum, report.dimensions);
      report.postgresAfter = report.verification.count;
    } else {
      await client.query("ROLLBACK");
      transactionOpen = false;
    }
    report.status = "ok";
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    if (error?.code === "INVALID_SOURCE_ROW" && report.rejected === 0) report.rejected = 1;
    report.errors.push({ code: error instanceof MigrationError ? error.code : "MIGRATION_FAILED",
      detail: error instanceof MigrationError ? error.message : "Migration failed; inspect private server logs" });
    report.status = "failed";
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool?.end().catch(() => undefined);
    db?.close();
    report.durationMs = Date.now() - started;
    report.rssDeltaBytes = process.memoryUsage().rss - rssBefore;
    console.log(JSON.stringify(report));
  }
}

if (require.main === module) void main();
module.exports = { canonical, expectedFromRow, sourceCheck, sourceSummary };
