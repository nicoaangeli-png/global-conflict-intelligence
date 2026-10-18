const { createHash } = require("node:crypto");
const { chmod, mkdir, readFile } = require("node:fs/promises");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const TABLE_SQL = `
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

const INDEX_SQL = `
CREATE INDEX IF NOT EXISTS conflict_events_event_ts_idx ON conflict_events (event_ts);
CREATE INDEX IF NOT EXISTS conflict_events_dataset_event_ts_idx ON conflict_events (source_dataset, event_ts);
CREATE INDEX IF NOT EXISTS conflict_events_type_event_ts_idx ON conflict_events (event_type, event_ts);
CREATE INDEX IF NOT EXISTS conflict_events_country_event_ts_idx ON conflict_events (country, event_ts);
CREATE INDEX IF NOT EXISTS conflict_events_country_iso3_event_ts_idx ON conflict_events (country_iso3, event_ts);
CREATE INDEX IF NOT EXISTS conflict_events_geo_idx ON conflict_events (lat, lon);
CREATE INDEX IF NOT EXISTS conflict_events_updated_idx ON conflict_events (updated_at);
`;

const sha256 = (content) => createHash("sha256").update(content).digest("hex");

function iso3Of(event) {
  const candidate = [event.countryIso3, event.country_iso3, event.iso3]
    .find((value) => typeof value === "string")
    ?.trim()
    .toUpperCase();
  return candidate && /^[A-Z]{3}$/.test(candidate) ? candidate : null;
}

function validateEvent(event, index) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error(`Invalid event at index ${index}`);
  for (const field of ["id", "sourceDataset", "eventType", "confidence", "eventDate", "updatedAt"]) {
    if (typeof event[field] !== "string" || !event[field]) throw new Error(`Invalid ${field} at index ${index}`);
  }
  if (typeof event.country !== "string") throw new Error(`Invalid country at index ${index}`);
  for (const field of ["latitude", "longitude", "fatalities"]) {
    if (!Number.isFinite(event[field])) throw new Error(`Invalid ${field} at index ${index}`);
  }
}

function countRows(database) {
  return Number(database.prepare("SELECT COUNT(*) AS count FROM conflict_events").get().count);
}

function timestampOf(value) {
  const timestamp = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function ensureTimestampSchema(database) {
  const columns = database.prepare("PRAGMA table_info('conflict_events')").all();
  if (!columns.some((column) => column.name === "event_ts")) {
    database.exec("ALTER TABLE conflict_events ADD COLUMN event_ts INTEGER;");
  }
  const pending = database.prepare("SELECT id, payload FROM conflict_events WHERE event_ts IS NULL").all();
  const update = database.prepare("UPDATE conflict_events SET event_ts = ? WHERE id = ?");
  for (const row of pending) {
    update.run(timestampOf(JSON.parse(row.payload).eventDate), row.id);
  }
}

async function migrateJsonToSqlite(sourceFilename, targetFilename) {
  const source = path.resolve(sourceFilename);
  const target = path.resolve(targetFilename);
  if (source === target) throw new Error("Source and target must be different files");
  const original = await readFile(source);
  const sourceSha256 = sha256(original);
  const events = JSON.parse(original.toString("utf8"));
  if (!Array.isArray(events)) throw new Error("Invalid JSON store: expected an array");
  events.forEach(validateEvent);

  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(target, { timeout: 5_000 });
  let report;
  try {
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec("PRAGMA busy_timeout = 5000;");
    database.exec("PRAGMA synchronous = NORMAL;");
    let inserted = 0;
    let updated = 0;
    database.exec("BEGIN IMMEDIATE;");
    try {
      database.exec(TABLE_SQL);
      ensureTimestampSchema(database);
      database.exec(INDEX_SQL);
      database.exec("CREATE TEMP TABLE migration_expected (id TEXT PRIMARY KEY, payload TEXT NOT NULL) WITHOUT ROWID;");
      const before = countRows(database);
      const exists = database.prepare("SELECT 1 AS present FROM conflict_events WHERE id = ?");
      const expected = database.prepare("INSERT OR REPLACE INTO migration_expected (id, payload) VALUES (?, ?)");
      const upsert = database.prepare(`
        INSERT INTO conflict_events (
          id, source_dataset, event_type, country, country_iso3, confidence,
          fatalities, event_date, event_ts, lat, lon, updated_at, payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source_dataset = excluded.source_dataset,
          event_type = excluded.event_type,
          country = excluded.country,
          country_iso3 = excluded.country_iso3,
          confidence = excluded.confidence,
          fatalities = excluded.fatalities,
          event_date = excluded.event_date,
          event_ts = excluded.event_ts,
          lat = excluded.lat,
          lon = excluded.lon,
          updated_at = excluded.updated_at,
          payload = excluded.payload
      `);
      for (const event of events) {
        const payload = JSON.stringify(event);
        if (exists.get(event.id)) updated++;
        else inserted++;
        expected.run(event.id, payload);
        upsert.run(
          event.id,
          event.sourceDataset,
          event.eventType,
          event.country,
          iso3Of(event),
          event.confidence,
          event.fatalities,
          event.eventDate,
          timestampOf(event.eventDate),
          event.latitude,
          event.longitude,
          event.updatedAt,
          payload,
        );
      }
      const after = countRows(database);
      const distinctSourceRecords = Number(database.prepare("SELECT COUNT(*) AS count FROM migration_expected").get().count);
      const missing = Number(database.prepare(`
        SELECT COUNT(*) AS count
        FROM migration_expected expected
        LEFT JOIN conflict_events stored ON stored.id = expected.id
        WHERE stored.id IS NULL
      `).get().count);
      const payloadMismatches = Number(database.prepare(`
        SELECT COUNT(*) AS count
        FROM migration_expected expected
        JOIN conflict_events stored ON stored.id = expected.id
        WHERE stored.payload <> expected.payload
      `).get().count);
      const integrity = database.prepare("PRAGMA integrity_check").get().integrity_check;
      const sourceAfterSha256 = sha256(await readFile(source));
      const verified = missing === 0
        && payloadMismatches === 0
        && integrity === "ok"
        && sourceSha256 === sourceAfterSha256;
      if (!verified) throw new Error("Migration integrity verification failed");
      database.exec("COMMIT;");
      report = {
        source,
        target,
        sourceRecords: events.length,
        distinctSourceRecords,
        before,
        after,
        inserted,
        updated,
        missing,
        payloadMismatches,
        sqliteIntegrity: integrity,
        sourceUnchanged: true,
        sourceSha256,
        verified,
      };
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
    database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } finally {
    database.close();
  }
  await chmod(target, 0o600);
  return report;
}

module.exports = { migrateJsonToSqlite };

if (require.main === module) {
  const args = process.argv.slice(2);
  let source = "data/intel-events.json";
  let target = "data/intel-events.sqlite";
  let valid = true;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === "--source" && value && !value.startsWith("-")) {
      source = value;
      index++;
    } else if (argument === "--target" && value && !value.startsWith("-")) {
      target = value;
      index++;
    } else {
      valid = false;
      break;
    }
  }
  if (!valid) {
    console.error("Usage: node scripts/migrate-json-to-sqlite.cjs [--source file.json] [--target file.sqlite]");
    process.exitCode = 1;
  } else {
    migrateJsonToSqlite(source, target)
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((error) => {
        console.error(error instanceof Error ? error.message : "Migration failed");
        process.exitCode = 1;
      });
  }
}
