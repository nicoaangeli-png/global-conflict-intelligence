import type { ConflictEvent } from "@/types/conflict";
import { chmod, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { assertRealSourceRecords } from "./dataPolicy";
import type { EventQuery, Repository } from "./repository";

const DAY_MS = 86_400_000;
const DEFAULT_GDELT_RETENTION_DAYS = 30;
const DEFAULT_FIRMS_RETENTION_DAYS = 14;
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
/** Taille d'un lot synchrone avant de rendre la main à la boucle Node.js. */
export const SQLITE_UPSERT_BATCH_SIZE = 500;

const SQLITE_TABLE_SQL = `
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

const SQLITE_INDEX_SQL = `
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

export interface SqliteRepositoryOptions {
  busyTimeoutMs?: number;
  gdeltRetentionDays?: number;
  firmsRetentionDays?: number;
  /** Réservé à la migration : l'application conserve toujours la purge automatique. */
  applyRetention?: boolean;
  /** JSON historique à importer seulement lorsque la base est vide. */
  initialJsonPath?: string;
  now?: () => Date;
}

interface SqliteEventRow {
  payload: string;
}

interface CountRow {
  source_dataset: string;
  count: number;
}

function envInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function countryIso3(event: ConflictEvent): string | null {
  const extended = event as ConflictEvent & {
    countryIso3?: unknown;
    country_iso3?: unknown;
    iso3?: unknown;
  };
  const candidate = [extended.countryIso3, extended.country_iso3, extended.iso3]
    .find((value): value is string => typeof value === "string")
    ?.trim()
    .toUpperCase();
  return candidate && /^[A-Z]{3}$/.test(candidate) ? candidate : null;
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(",");
}

function timestampOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function validateEvent(event: unknown, index: number): asserts event is ConflictEvent {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error(`Invalid event at index ${index}`);
  }
  const record = event as Record<string, unknown>;
  for (const field of ["id", "sourceDataset", "eventType", "confidence", "eventDate", "updatedAt"]) {
    if (typeof record[field] !== "string" || !record[field]) throw new Error(`Invalid ${field} at index ${index}`);
  }
  if (typeof record.country !== "string") throw new Error(`Invalid country at index ${index}`);
  for (const field of ["latitude", "longitude", "fatalities"]) {
    if (!Number.isFinite(record[field])) throw new Error(`Invalid ${field} at index ${index}`);
  }
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

function prepareWrite(database: DatabaseSync) {
  return database.prepare(`
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
}

function writeEvent(
  write: ReturnType<DatabaseSync["prepare"]>,
  event: ConflictEvent,
  payload = JSON.stringify(event),
): void {
  write.run(
    event.id,
    event.sourceDataset,
    event.eventType,
    event.country,
    countryIso3(event),
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

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

async function secureSqliteFiles(filename: string): Promise<void> {
  await Promise.all([filename, `${filename}-wal`, `${filename}-shm`].map(async (candidate) => {
    try {
      await chmod(candidate, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }));
}

/**
 * Dépôt durable local fondé sur le module natif `node:sqlite`.
 *
 * Le JSON complet reste la représentation canonique : les colonnes séparées
 * servent uniquement aux filtres et aux index et n'éliminent donc aucun champ
 * additif provenant des connecteurs.
 */
export class SqliteRepository implements Repository {
  readonly kind = "sqlite" as const;
  private database: DatabaseSync | null = null;
  private readonly busyTimeoutMs: number;
  private readonly gdeltRetentionDays: number;
  private readonly firmsRetentionDays: number;
  private readonly applyRetention: boolean;
  private readonly initialJsonPath: string | null;
  private readonly now: () => Date;

  constructor(
    private readonly filename = process.env.ORBITAL_SQLITE_PATH ?? path.join(process.cwd(), "data", "intel-events.sqlite"),
    options: SqliteRepositoryOptions = {},
  ) {
    this.busyTimeoutMs = options.busyTimeoutMs ?? envInteger("ORBITAL_SQLITE_BUSY_TIMEOUT_MS", DEFAULT_BUSY_TIMEOUT_MS);
    this.gdeltRetentionDays = options.gdeltRetentionDays ?? envInteger("ORBITAL_RETENTION_GDELT_DAYS", DEFAULT_GDELT_RETENTION_DAYS);
    this.firmsRetentionDays = options.firmsRetentionDays ?? envInteger("ORBITAL_RETENTION_FIRMS_DAYS", DEFAULT_FIRMS_RETENTION_DAYS);
    this.applyRetention = options.applyRetention ?? true;
    this.initialJsonPath = options.initialJsonPath
      ?? (filename === ":memory:" ? null : path.join(path.dirname(filename), "intel-events.json"));
    this.now = options.now ?? (() => new Date());
  }

  async init(): Promise<void> {
    if (this.database) return;
    if (this.filename !== ":memory:") await mkdir(path.dirname(this.filename), { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(this.filename, { timeout: this.busyTimeoutMs });
    try {
      database.exec(`PRAGMA journal_mode = WAL;`);
      database.exec(`PRAGMA busy_timeout = ${this.busyTimeoutMs};`);
      database.exec("PRAGMA synchronous = NORMAL;");
      database.exec("BEGIN IMMEDIATE;");
      try {
        database.exec(SQLITE_TABLE_SQL);
        ensureTimestampSchema(database);
        database.exec(SQLITE_INDEX_SQL);
        database.exec("COMMIT;");
      } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
      }
      this.database = database;
      await this.importInitialJson(database);
      if (this.filename !== ":memory:") await secureSqliteFiles(this.filename);
      if (this.applyRetention) await this.purgeExpired(this.now());
    } catch (error) {
      database.close();
      this.database = null;
      throw error;
    }
  }

  private get db(): DatabaseSync {
    if (!this.database) throw new Error("SqliteRepository non initialisé");
    return this.database;
  }

  private async importInitialJson(database: DatabaseSync): Promise<void> {
    if (!this.initialJsonPath) return;
    const count = Number((database.prepare("SELECT COUNT(*) AS count FROM conflict_events").get() as { count: number }).count);
    if (count !== 0) return;

    let raw: string;
    try {
      raw = await readFile(this.initialJsonPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new Error(`Import initial SQLite impossible: lecture de ${this.initialJsonPath}`, { cause: error });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("Invalid JSON store: expected an array");
      parsed.forEach(validateEvent);
    } catch (error) {
      throw new Error(`Import initial SQLite invalide depuis ${this.initialJsonPath}`, { cause: error });
    }
    const events = parsed as ConflictEvent[];
    if (!events.length) return;

    const write = prepareWrite(database);
    database.exec("BEGIN IMMEDIATE;");
    try {
      for (let index = 0; index < events.length; index++) {
        writeEvent(write, events[index]);
        if ((index + 1) % SQLITE_UPSERT_BATCH_SIZE === 0) await yieldToEventLoop();
      }
      database.exec("COMMIT;");
    } catch (error) {
      database.exec("ROLLBACK;");
      throw new Error(`Import initial SQLite échoué depuis ${this.initialJsonPath}`, { cause: error });
    }
    console.info(`import initial ${events.length} événements depuis le JSON`);
  }

  async upsert(events: ConflictEvent[]): Promise<{ inserted: number; updated: number }> {
    assertRealSourceRecords(events);
    if (!events.length) {
      if (this.applyRetention) await this.purgeExpired(this.now());
      return { inserted: 0, updated: 0 };
    }

    events.forEach(validateEvent);
    const exists = this.db.prepare("SELECT 1 AS present FROM conflict_events WHERE id = ?");
    const write = prepareWrite(this.db);
    let inserted = 0;
    let updated = 0;
    for (let start = 0; start < events.length; start += SQLITE_UPSERT_BATCH_SIZE) {
      const end = Math.min(start + SQLITE_UPSERT_BATCH_SIZE, events.length);
      this.db.exec("BEGIN IMMEDIATE");
      try {
        for (let index = start; index < end; index++) {
          const event = events[index];
          if (exists.get(event.id)) updated++;
          else inserted++;
          writeEvent(write, event);
        }
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      if (end < events.length) await yieldToEventLoop();
    }
    if (this.applyRetention) await this.purgeExpired(this.now());
    return { inserted, updated };
  }

  async query(q: EventQuery): Promise<ConflictEvent[]> {
    const where = ["event_ts >= ?", "event_ts <= ?"];
    const values: SQLOutputValue[] = [q.from.getTime(), q.to.getTime()];
    const addList = (column: string, items: readonly string[]) => {
      if (!items.length) return;
      where.push(`${column} IN (${placeholders(items)})`);
      values.push(...items);
    };
    addList("event_type", q.types ?? []);
    addList("source_dataset", q.datasets ?? []);
    addList("confidence", q.confidences ?? []);
    if (q.countries?.length) {
      const marks = placeholders(q.countries);
      where.push(`(country IN (${marks}) OR country_iso3 IN (${marks}))`);
      values.push(...q.countries, ...q.countries.map((country) => country.toUpperCase()));
    }
    if (q.minFatalities != null) {
      where.push("fatalities >= ?");
      values.push(q.minFatalities);
    }
    const rows = this.db.prepare(`
      SELECT payload FROM conflict_events
      WHERE ${where.join(" AND ")}
      ORDER BY event_ts DESC, id
    `).all(...values) as unknown as SqliteEventRow[];
    return rows.map((row) => JSON.parse(row.payload) as ConflictEvent);
  }

  async byIds(ids: string[]): Promise<ConflictEvent[]> {
    if (!ids.length) return [];
    const rows: SqliteEventRow[] = [];
    for (let index = 0; index < ids.length; index += 500) {
      const slice = ids.slice(index, index + 500);
      rows.push(...this.db.prepare(
        `SELECT payload FROM conflict_events WHERE id IN (${placeholders(slice)})`,
      ).all(...slice) as unknown as SqliteEventRow[]);
    }
    return rows.map((row) => JSON.parse(row.payload) as ConflictEvent);
  }

  async counts(): Promise<{ total: number; byDataset: Record<string, number>; lastUpdated: string | null }> {
    const rows = this.db.prepare(`
      SELECT source_dataset, COUNT(*) AS count
      FROM conflict_events GROUP BY source_dataset
    `).all() as unknown as CountRow[];
    const latest = this.db.prepare("SELECT MAX(updated_at) AS updated_at FROM conflict_events").get() as
      | { updated_at: string | null }
      | undefined;
    const byDataset: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      byDataset[row.source_dataset] = Number(row.count);
      total += Number(row.count);
    }
    return { total, byDataset, lastUpdated: latest?.updated_at ?? null };
  }

  async clear(): Promise<void> {
    this.db.exec("DELETE FROM conflict_events");
  }

  async purgeExpired(now = this.now()): Promise<{ gdelt: number; firms: number }> {
    const purge = (dataset: "gdelt" | "firms", retentionDays: number): number => {
      if (retentionDays === 0) return 0;
      const cutoff = now.getTime() - retentionDays * DAY_MS;
      return Number(this.db.prepare(
        "DELETE FROM conflict_events WHERE source_dataset = ? AND event_ts IS NOT NULL AND event_ts < ?",
      ).run(dataset, cutoff).changes);
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const gdelt = purge("gdelt", this.gdeltRetentionDays);
      const firms = purge("firms", this.firmsRetentionDays);
      this.db.exec("COMMIT");
      return { gdelt, firms };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    if (!this.database) return;
    this.database.close();
    this.database = null;
  }
}
