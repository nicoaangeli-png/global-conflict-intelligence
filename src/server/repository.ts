import type { Confidence, ConflictEvent, EventType } from "@/types/conflict";

/**
 * Couche de persistance.
 *
 * Deux implémentations derrière la même interface :
 *  - `MemoryRepository` : zéro configuration, utilisée par défaut ;
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
  readonly kind: "memory" | "postgres";
  init(): Promise<void>;
  upsert(events: ConflictEvent[]): Promise<{ inserted: number; updated: number }>;
  query(q: EventQuery): Promise<ConflictEvent[]>;
  byIds(ids: string[]): Promise<ConflictEvent[]>;
  counts(): Promise<{ total: number; byDataset: Record<string, number>; lastUpdated: string | null }>;
  clear(): Promise<void>;
}

const keyOf = (e: ConflictEvent) => `${e.sourceDataset}|${e.id}`;

function matches(e: ConflictEvent, q: EventQuery): boolean {
  const t = Date.parse(e.eventDate);
  if (t < q.from.getTime() || t > q.to.getTime()) return false;
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

/** Implémentation PostgreSQL (activée par DATABASE_URL). */
export class PgRepository implements Repository {
  readonly kind = "postgres" as const;
  private pool: import("pg").Pool | null = null;

  constructor(private connectionString: string) {}

  async init() {
    const { Pool } = await import("pg");
    this.pool = new Pool({ connectionString: this.connectionString, max: 6 });
    await this.pool.query(SCHEMA_SQL);
  }

  private get db() {
    if (!this.pool) throw new Error("PgRepository non initialisé");
    return this.pool;
  }

  async upsert(events: ConflictEvent[]) {
    let inserted = 0;
    const chunk = 500;
    for (let i = 0; i < events.length; i += chunk) {
      const slice = events.slice(i, i + chunk);
      const values: unknown[] = [];
      const tuples = slice.map((e, idx) => {
        const b = idx * 15;
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
        );
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14},$${b + 15})`;
      });
      const res = await this.db.query(
        `INSERT INTO conflict_events (
           id, source_dataset, latitude, longitude, country, region, locality,
           event_type, sub_event_type, actors, fatalities, source, source_url,
           confidence, event_date
         ) VALUES ${tuples.join(",")}
         ON CONFLICT (id) DO UPDATE SET
           fatalities = EXCLUDED.fatalities,
           confidence = EXCLUDED.confidence,
           source = EXCLUDED.source,
           updated_at = now()`,
        values,
      );
      inserted += res.rowCount ?? 0;
    }
    return { inserted, updated: Math.max(0, events.length - inserted) };
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
    if (q.countries?.length) add("country = ANY($?)", q.countries);
    if (q.minFatalities != null) add("fatalities >= $?", q.minFatalities);

    const res = await this.db.query(
      `SELECT id, latitude, longitude, country, region, locality, event_type,
              sub_event_type, actors, fatalities, source, source_url,
              source_dataset, confidence, event_date, updated_at
         FROM conflict_events
        WHERE ${where.join(" AND ")}
        LIMIT 200000`,
      values,
    );
    return res.rows.map(rowToEvent);
  }

  async byIds(ids: string[]) {
    if (!ids.length) return [];
    const res = await this.db.query(
      `SELECT id, latitude, longitude, country, region, locality, event_type,
              sub_event_type, actors, fatalities, source, source_url,
              source_dataset, confidence, event_date, updated_at
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
}

function rowToEvent(r: PgRow): ConflictEvent {
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
