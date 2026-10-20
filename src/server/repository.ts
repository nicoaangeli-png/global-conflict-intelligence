import "server-only";
import type { Confidence, ConflictEvent, EventType } from "@/types/conflict";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertRealSourceRecords } from "./dataPolicy";
import { SqliteRepository } from "./sqliteRepository";
import { migratePostgres, type PostgresMigrationReport } from "./migrations/postgres";

/**
 * Couche de persistance.
 *
 * Quatre implémentations derrière la même interface :
 *  - `MemoryRepository` : stockage éphémère pour les tests ;
 *  - `SqliteRepository` : stockage local durable par défaut ;
 *  - `LocalRepository` : ancien stockage JSON, repli explicite ;
 *  - `PgRepository` : PostgreSQL (PostGIS optionnel), activée par DATABASE_URL.
 *
 * Les requêtes géographiques restent volontairement simples (fenêtre
 * temporelle + filtres + agrégation applicative) afin de fonctionner à
 * l'identique avec ou sans PostGIS. Le schéma SQL prévoit la colonne
 * `geography(Point,4326)` pour les déploiements PostGIS.
 */

export interface EventQuery {
  from: Date;
  to: Date;
  types?: EventType[];
  datasets?: string[];
  confidences?: Confidence[];
  countries?: string[];
  minFatalities?: number;
}

export interface Repository {
  readonly kind: "memory" | "local" | "sqlite" | "postgres";
  init(): Promise<void>;
  upsert(events: ConflictEvent[]): Promise<{ inserted: number; updated: number }>;
  query(q: EventQuery): Promise<ConflictEvent[]>;
  byIds(ids: string[]): Promise<ConflictEvent[]>;
  counts(): Promise<{ total: number; byDataset: Record<string, number>; lastUpdated: string | null }>;
  clear(): Promise<void>;
  close?(): void | Promise<void>;
  /** Version du schéma et intégrité (SQLite, PostgreSQL) ; absent pour les dépôts sans schéma. */
  diagnostics?(): { schemaVersion: number | null; appliedMigrations: number[]; integrity: string | null };
}

/** Sélectionne le stockage sans changer la priorité historique de PostgreSQL. */
export function createRepository(): Repository {
  const url = process.env.DATABASE_URL;
  if (url) return new PgRepository(url);
  if (process.env.ORBITAL_STORAGE?.trim().toLowerCase() === "json") return new LocalRepository();
  return new SqliteRepository();
}

const keyOf = (e: ConflictEvent) => `${e.sourceDataset}|${e.id}`;

function matches(e: ConflictEvent, q: EventQuery): boolean {
  const t = Date.parse(e.eventDate);
  if (!Number.isFinite(t) || t < q.from.getTime() || t > q.to.getTime()) return false;
  if (q.types?.length && !q.types.includes(e.eventType)) return false;
  if (q.datasets?.length && !q.datasets.includes(e.sourceDataset)) return false;
  if (q.confidences?.length && !q.confidences.includes(e.confidence)) return false;
  if (q.countries?.length && !q.countries.includes(e.country)) return false;
  if (q.minFatalities != null && e.fatalities < q.minFatalities) return false;
  return true;
}

export class MemoryRepository implements Repository {
  readonly kind = "memory" as const;
  private store = new Map<string, ConflictEvent>();
  private lastUpdated: string | null = null;

  async init() {}

  async upsert(events: ConflictEvent[]) {
    let inserted = 0;
    let updated = 0;
    for (const e of events) {
      const k = keyOf(e);
      if (this.store.has(k)) updated++;
      else inserted++;
      this.store.set(k, e);
      if (!this.lastUpdated || e.updatedAt > this.lastUpdated) this.lastUpdated = e.updatedAt;
    }
    return { inserted, updated };
  }

  async query(q: EventQuery) {
    const out: ConflictEvent[] = [];
    for (const e of this.store.values()) if (matches(e, q)) out.push(e);
    return out;
  }

  async byIds(ids: string[]) {
    const set = new Set(ids);
    const out: ConflictEvent[] = [];
    for (const e of this.store.values()) if (set.has(e.id)) out.push(e);
    return out;
  }

  async counts() {
    const byDataset: Record<string, number> = {};
    for (const e of this.store.values()) byDataset[e.sourceDataset] = (byDataset[e.sourceDataset] ?? 0) + 1;
    return { total: this.store.size, byDataset, lastUpdated: this.lastUpdated };
  }

  async clear() {
    this.store.clear();
    this.lastUpdated = null;
  }
}

export class LocalRepository implements Repository {
  readonly kind = "local" as const;

  constructor(private filename = process.env.INTEL_STORE_PATH ?? path.join(process.cwd(), "data", "intel-events.json")) {}

  async init() {
    await mkdir(path.dirname(this.filename), { recursive: true, mode: 0o700 });
    await this.read();
  }

  private async read(): Promise<ConflictEvent[]> {
    try {
      const events: unknown = JSON.parse(await readFile(this.filename, "utf8"));
      if (!Array.isArray(events)) throw new Error("Invalid local event store");
      return events as ConflictEvent[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("Local event store cannot be read safely");
    }
  }

  private async mutate(events: ConflictEvent[] | null) {
    const lockPath = `${this.filename}.lock`;
    const deadline = Date.now() + 5000;
    let lock;
    while (!lock) {
      try {
        lock = await open(lockPath, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) {
          throw new Error("Local event store is not writable or is locked");
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    const temporary = `${this.filename}.${randomUUID()}.tmp`;
    try {
      const store = new Map((await this.read()).map((event) => [keyOf(event), event]));
      let inserted = 0;
      let updated = 0;
      if (events === null) store.clear();
      for (const event of events ?? []) {
        if (store.has(keyOf(event))) updated++;
        else inserted++;
        store.set(keyOf(event), event);
      }
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify([...store.values()]));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.filename);
      return { inserted, updated };
    } finally {
      await unlink(temporary).catch(() => undefined);
      await lock.close();
      await unlink(lockPath);
    }
  }

  async upsert(events: ConflictEvent[]) {
    assertRealSourceRecords(events);
    return this.mutate(events);
  }
  async query(query: EventQuery) { return (await this.read()).filter((event) => matches(event, query)); }
  async byIds(ids: string[]) { return (await this.read()).filter((event) => ids.includes(event.id)); }
  async counts() {
    const repository = new MemoryRepository();
    await repository.upsert(await this.read());
    return repository.counts();
  }
  async clear() { await this.mutate(null); }
}

export { SCHEMA_SQL } from "./migrations/postgres";

/** Implémentation PostgreSQL (activée par DATABASE_URL). */
export class PgRepository implements Repository {
  readonly kind = "postgres" as const;
  private pool: import("pg").Pool | null = null;
  private migration: PostgresMigrationReport | null = null;

  /** Version du schéma et migrations appliquées à l'ouverture. */
  diagnostics(): { schemaVersion: number | null; appliedMigrations: number[]; integrity: string | null } {
    return { schemaVersion: this.migration?.to ?? null, appliedMigrations: this.migration?.applied ?? [], integrity: null };
  }

  constructor(private connectionString: string) {}

  async init() {
    const { Pool } = await import("pg");
    this.pool = new Pool({ connectionString: this.connectionString, max: 6 });
    try {
      this.migration = await migratePostgres(this.pool);
    } catch (error) {
      await this.pool.end().catch(() => undefined);
      this.pool = null;
      throw error;
    }
  }

  private get db() {
    if (!this.pool) throw new Error("PgRepository non initialisé");
    return this.pool;
  }

  async upsert(events: ConflictEvent[]) {
    assertRealSourceRecords(events);
    let inserted = 0;
    let updated = 0;
    const chunk = 500;
    for (let i = 0; i < events.length; i += chunk) {
      const slice = events.slice(i, i + chunk);
      const values: unknown[] = [];
      const tuples = slice.map((e, idx) => {
        const b = idx * 17;
        values.push(
          e.id,
          e.sourceDataset,
          e.latitude,
          e.longitude,
          e.country,
          e.region,
          e.locality,
          e.eventType,
          e.subEventType,
          e.actors,
          e.fatalities,
          e.source,
          e.sourceUrl,
          e.confidence,
          e.eventDate,
          countryIso3Of(e),
          JSON.stringify(e),
        );
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14},$${b + 15},$${b + 16},$${b + 17}::jsonb)`;
      });
      const res = await this.db.query(
        `INSERT INTO conflict_events (
           id, source_dataset, latitude, longitude, country, region, locality,
           event_type, sub_event_type, actors, fatalities, source, source_url,
           confidence, event_date, country_iso3, payload
         ) VALUES ${tuples.join(",")}
         ON CONFLICT (id) DO UPDATE SET
           source_dataset = EXCLUDED.source_dataset,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           country = EXCLUDED.country,
           region = EXCLUDED.region,
           locality = EXCLUDED.locality,
           event_type = EXCLUDED.event_type,
           sub_event_type = EXCLUDED.sub_event_type,
           actors = EXCLUDED.actors,
           event_date = EXCLUDED.event_date,
           source_url = EXCLUDED.source_url,
           fatalities = EXCLUDED.fatalities,
           confidence = EXCLUDED.confidence,
           source = EXCLUDED.source,
           country_iso3 = EXCLUDED.country_iso3,
           payload = EXCLUDED.payload,
           updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        values,
      );
      inserted += res.rows.filter((row) => row.inserted).length;
      updated += res.rows.filter((row) => !row.inserted).length;
    }
    await this.purgeExpired();
    return { inserted, updated };
  }

  /** Rétention des flux volumineux, identique à SQLite (ORBITAL_RETENTION_GDELT_DAYS / _FIRMS_DAYS). */
  async purgeExpired(now = new Date()): Promise<{ gdelt: number; firms: number }> {
    const purge = async (dataset: "gdelt" | "firms", days: number) => {
      if (days === 0) return 0;
      const res = await this.db.query("DELETE FROM conflict_events WHERE source_dataset = $1 AND event_date < $2", [dataset, new Date(now.getTime() - days * 86_400_000).toISOString()]);
      return res.rowCount ?? 0;
    };
    return { gdelt: await purge("gdelt", retentionDays("ORBITAL_RETENTION_GDELT_DAYS", 30)), firms: await purge("firms", retentionDays("ORBITAL_RETENTION_FIRMS_DAYS", 14)) };
  }

  async query(q: EventQuery) {
    const where: string[] = ["event_date >= $1", "event_date <= $2"];
    const values: unknown[] = [q.from.toISOString(), q.to.toISOString()];
    const add = (sql: string, v: unknown) => {
      values.push(v);
      where.push(sql.replace("$?", `$${values.length}`));
    };
    if (q.types?.length) add("event_type = ANY($?)", q.types);
    if (q.datasets?.length) add("source_dataset = ANY($?)", q.datasets);
    if (q.confidences?.length) add("confidence = ANY($?)", q.confidences);
    if (q.countries?.length) {
      // Comme SQLite : nom stocké ou code ISO3.
      add("(country = ANY($?)", q.countries);
      values.push(q.countries.map((country) => country.toUpperCase()));
      where[where.length - 1] += ` OR country_iso3 = ANY($${values.length}))`;
    }
    if (q.minFatalities != null) add("fatalities >= $?", q.minFatalities);

    const res = await this.db.query(
      `SELECT id, latitude, longitude, country, region, locality, event_type,
              sub_event_type, actors, fatalities, source, source_url,
              source_dataset, confidence, event_date, updated_at, payload
         FROM conflict_events
        WHERE ${where.join(" AND ")}
        ORDER BY event_date DESC, id`,
      values,
    );
    return res.rows.map(rowToEvent);
  }

  async byIds(ids: string[]) {
    if (!ids.length) return [];
    const res = await this.db.query(
      `SELECT id, latitude, longitude, country, region, locality, event_type,
              sub_event_type, actors, fatalities, source, source_url,
              source_dataset, confidence, event_date, updated_at, payload
         FROM conflict_events WHERE id = ANY($1) LIMIT 5000`,
      [ids],
    );
    return res.rows.map(rowToEvent);
  }

  async counts() {
    const res = await this.db.query<{ source_dataset: string; n: string }>(
      `SELECT source_dataset, COUNT(*)::text AS n FROM conflict_events GROUP BY source_dataset`,
    );
    const last = await this.db.query<{ m: string | null }>(
      `SELECT MAX(updated_at)::text AS m FROM conflict_events`,
    );
    const byDataset: Record<string, number> = {};
    let total = 0;
    for (const r of res.rows) {
      byDataset[r.source_dataset] = Number(r.n);
      total += Number(r.n);
    }
    return { total, byDataset, lastUpdated: last.rows[0]?.m ?? null };
  }

  async clear() {
    await this.db.query("TRUNCATE conflict_events");
  }
}

interface PgRow {
  id: string;
  latitude: number;
  longitude: number;
  country: string;
  region: string;
  locality: string;
  event_type: string;
  sub_event_type: string;
  actors: string[];
  fatalities: number;
  source: string;
  source_url: string;
  source_dataset: string;
  confidence: string;
  event_date: Date | string;
  updated_at: Date | string;
  /** JSON complet (schéma v2) ; null pour les lignes écrites avant la migration. */
  payload?: ConflictEvent | null;
}

function retentionDays(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw == null || raw.trim() === "" ? fallback : Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function countryIso3Of(event: ConflictEvent): string | null {
  const candidate = (event as ConflictEvent & { countryIso3?: unknown }).countryIso3;
  return typeof candidate === "string" && /^[A-Z]{3}$/.test(candidate) ? candidate : null;
}

function rowToEvent(r: PgRow): ConflictEvent {
  // Le JSON complet fait foi (champs additifs des connecteurs) ; colonnes = repli historique.
  if (r.payload && typeof r.payload === "object") return { ...r.payload, updatedAt: new Date(r.updated_at).toISOString() };
  return {
    id: r.id,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    country: r.country,
    region: r.region,
    locality: r.locality,
    eventType: r.event_type as EventType,
    subEventType: r.sub_event_type,
    actors: r.actors ?? [],
    fatalities: Number(r.fatalities),
    source: r.source,
    sourceUrl: r.source_url,
    sourceDataset: r.source_dataset,
    confidence: r.confidence as Confidence,
    eventDate: new Date(r.event_date).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}
