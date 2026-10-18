import type { ConflictEvent } from "@/types/conflict";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { assertRealSourceRecords } from "./dataPolicy";
import type { EventQuery, Repository } from "./repository";

const DAY_MS = 86_400_000;
const DEFAULT_GDELT_RETENTION_DAYS = 30;
const DEFAULT_FIRMS_RETENTION_DAYS = 14;
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

export const SQLITE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conflict_events (
  id              TEXT PRIMARY KEY,
  source_dataset  TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  country         TEXT NOT NULL DEFAULT '',
  country_iso3    TEXT,
  confidence      TEXT NOT NULL,
  fatalities      INTEGER NOT NULL DEFAULT 0,
  event_date      TEXT NOT NULL,
  lat             REAL NOT NULL,
  lon             REAL NOT NULL,
  updated_at      TEXT NOT NULL,
  payload         TEXT NOT NULL CHECK (json_valid(payload))
) STRICT;
CREATE INDEX IF NOT EXISTS conflict_events_date_idx
  ON conflict_events (event_date);
CREATE INDEX IF NOT EXISTS conflict_events_dataset_date_idx
  ON conflict_events (source_dataset, event_date);
CREATE INDEX IF NOT EXISTS conflict_events_type_date_idx
  ON conflict_events (event_type, event_date);
CREATE INDEX IF NOT EXISTS conflict_events_country_date_idx
  ON conflict_events (country, event_date);
CREATE INDEX IF NOT EXISTS conflict_events_country_iso3_date_idx
  ON conflict_events (country_iso3, event_date);
CREATE INDEX IF NOT EXISTS conflict_events_geo_idx
  ON conflict_events (lat, lon);
CREATE INDEX IF NOT EXISTS conflict_events_updated_idx
  ON conflict_events (updated_at);
`;

export interface SqliteRepositoryOptions {
  busyTimeoutMs?: number;
  gdeltRetentionDays?: number;
  firmsRetentionDays?: number;
  /** Réservé à la migration : l'application conserve toujours la purge automatique. */
  applyRetention?: boolean;
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
  private readonly now: () => Date;

  constructor(
    private readonly filename = process.env.ORBITAL_SQLITE_PATH ?? path.join(process.cwd(), "data", "intel-events.sqlite"),
    options: SqliteRepositoryOptions = {},
  ) {
    this.busyTimeoutMs = options.busyTimeoutMs ?? envInteger("ORBITAL_SQLITE_BUSY_TIMEOUT_MS", DEFAULT_BUSY_TIMEOUT_MS);
    this.gdeltRetentionDays = options.gdeltRetentionDays ?? envInteger("ORBITAL_RETENTION_GDELT_DAYS", DEFAULT_GDELT_RETENTION_DAYS);
    this.firmsRetentionDays = options.firmsRetentionDays ?? envInteger("ORBITAL_RETENTION_FIRMS_DAYS", DEFAULT_FIRMS_RETENTION_DAYS);
    this.applyRetention = options.applyRetention ?? true;
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
      database.exec(SQLITE_SCHEMA_SQL);
      this.database = database;
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

  async upsert(events: ConflictEvent[]): Promise<{ inserted: number; updated: number }> {
    assertRealSourceRecords(events);
    if (!events.length) {
      if (this.applyRetention) await this.purgeExpired(this.now());
      return { inserted: 0, updated: 0 };
    }

    const exists = this.db.prepare("SELECT 1 AS present FROM conflict_events WHERE id = ?");
    const write = this.db.prepare(`
      INSERT INTO conflict_events (
        id, source_dataset, event_type, country, country_iso3, confidence,
        fatalities, event_date, lat, lon, updated_at, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_dataset = excluded.source_dataset,
        event_type = excluded.event_type,
        country = excluded.country,
        country_iso3 = excluded.country_iso3,
        confidence = excluded.confidence,
        fatalities = excluded.fatalities,
        event_date = excluded.event_date,
        lat = excluded.lat,
        lon = excluded.lon,
        updated_at = excluded.updated_at,
        payload = excluded.payload
    `);
    let inserted = 0;
    let updated = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const event of events) {
        if (exists.get(event.id)) updated++;
        else inserted++;
        write.run(
          event.id,
          event.sourceDataset,
          event.eventType,
          event.country,
          countryIso3(event),
          event.confidence,
          event.fatalities,
          event.eventDate,
          event.latitude,
          event.longitude,
          event.updatedAt,
          JSON.stringify(event),
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    if (this.applyRetention) await this.purgeExpired(this.now());
    return { inserted, updated };
  }

  async query(q: EventQuery): Promise<ConflictEvent[]> {
    const where = ["event_date >= ?", "event_date <= ?"];
    const values: SQLOutputValue[] = [q.from.toISOString(), q.to.toISOString()];
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
      ORDER BY event_date DESC, id
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
      const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
      return Number(this.db.prepare(
        "DELETE FROM conflict_events WHERE source_dataset = ? AND event_date < ?",
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
