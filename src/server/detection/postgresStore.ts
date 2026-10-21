import "server-only";
import { Pool, type PoolClient } from "pg";
import type { OrbitalEvent, SignalKind } from "@/types/detection";
import { migratePostgres } from "../migrations/postgres";
import type { DetectionStore, DetectionTransaction } from "./store";
import { MAX_CANDIDATES } from "./limits";

/**
 * Backend PostgreSQL du moteur de détection.
 *
 * Plusieurs instances ORBITAL peuvent partager la même base. La cohérence repose sur :
 *  - une transaction READ COMMITTED par lot d'ingestion ;
 *  - un verrou consultatif par catégorie de signal (`lock`), pris dans un ordre trié
 *    pour éviter les interblocages entre instances ;
 *  - les contraintes primaires de `detection_events` et `detection_signals` ;
 *  - des UPSERT idempotents ;
 *  - la garde `last_received` qui empêche un instantané ancien d'écraser une ingestion
 *    plus récente.
 *
 * Aucun verrou de table ni verrou global de base : les autres catégories et les autres
 * tables ORBITAL restent accessibles pendant une ingestion.
 */

const LOCK_TIMEOUT = "30s";
const STATEMENT_TIMEOUT = "120s";

/** Colonnes minimales attendues : un schéma futur ou altéré est refusé au démarrage. */
const EXPECTED_COLUMNS: Record<string, string[]> = {
  detection_events: ["id", "kind", "anchor", "last_received", "payload", "created_at", "updated_at"],
  detection_signals: ["id", "event_id", "digest"],
};

const EXPECTED_TYPES: Record<string, string> = {
  "detection_events.id": "text",
  "detection_events.kind": "text",
  "detection_events.anchor": "double precision",
  "detection_events.last_received": "timestamp with time zone",
  "detection_events.payload": "jsonb",
  "detection_signals.id": "text",
  "detection_signals.event_id": "text",
  "detection_signals.digest": "text",
};

export interface PostgresDetectionOptions {
  connectionString: string;
  /** Taille du pool ; 4 suffit au moteur, l'ingestion étant séquentielle par transaction. */
  max?: number;
  /**
   * Schéma PostgreSQL, réservé aux tests d'isolation. Jamais alimenté par une entrée
   * utilisateur ; validé ci-dessous. Par défaut : `search_path` du serveur (public).
   */
  schema?: string;
}

export class PostgresDetectionStore implements DetectionStore {
  readonly kind = "postgres" as const;
  private pool: Pool;
  private ready: Promise<void>;

  constructor(options: string | PostgresDetectionOptions) {
    const config = typeof options === "string" ? { connectionString: options } : options;
    const schema = config.schema?.trim();
    if (schema && !/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error("Invalid PostgreSQL schema name");
    this.pool = new Pool({
      connectionString: config.connectionString,
      max: config.max ?? 4,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      application_name: "orbital-detection",
      ...(schema ? { options: `-c search_path=${schema}` } : {}),
    });
    // Un client inactif peut perdre sa connexion (redémarrage PostgreSQL, proxy) : sans
    // écouteur, pg ferait tomber le processus. L'erreur réelle remontera à la prochaine requête.
    this.pool.on("error", () => undefined);
    this.ready = this.initialize();
    // Évite une rejection non gérée si le store est construit puis jamais utilisé.
    this.ready.catch(() => undefined);
  }

  private async initialize() {
    await migratePostgres(this.pool);
    await this.verifySchema();
  }

  /** Refuse un schéma partiel ou d'un type incompatible, même si la table de versions ment. */
  private async verifySchema() {
    const result = await this.pool.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = ANY($1::text[])`,
      [Object.keys(EXPECTED_COLUMNS)],
    );
    const columns = new Map(result.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]));
    for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
      for (const column of expected) {
        const type = columns.get(`${table}.${column}`);
        if (type === undefined) throw new Error(`Incompatible detection schema: missing column ${table}.${column}`);
        const wanted = EXPECTED_TYPES[`${table}.${column}`];
        if (wanted && type !== wanted) throw new Error(`Incompatible detection schema: ${table}.${column} is ${type}, expected ${wanted}`);
      }
    }
  }

  async transaction<Result>(work: (transaction: DetectionTransaction) => Promise<Result>): Promise<Result> {
    await this.ready;
    const client = await this.pool.connect();
    let began = false;
    try {
      // Isolation explicite : si la base a un défaut différent (SERIALIZABLE), le
      // second writer doit voir le commit du premier après l'attente du verrou.
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      began = true;
      // Bornes de sûreté : une instance bloquée ne doit pas immobiliser les autres.
      await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'; SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
      const result = await work(new PostgresDetectionTransaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (began) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.ready.catch(() => undefined);
    await this.pool.end();
  }
}

class PostgresDetectionTransaction implements DetectionTransaction {
  constructor(private client: PoolClient) {}

  /**
   * Verrou transactionnel par catégorie, dans l'ordre lexicographique : toutes les
   * instances prennent les mêmes verrous dans le même ordre, donc pas de cycle.
   *
   * Pourquoi la catégorie entière plutôt qu'un intervalle temporel : deux signaux
   * séparés de moins de 45 minutes peuvent tomber de part et d'autre d'une frontière
   * de seau. Un verrou par seau exigerait de verrouiller les seaux voisins et laisse
   * toujours une course au bord de la fenêtre. Huit catégories au plus, quelques
   * millisecondes de sérialisation : le compromis est volontairement conservateur.
   */
  async lock(kinds: readonly SignalKind[]) {
    const unique = [...new Set(kinds)].sort();
    for (const kind of unique) {
      await this.client.query("SELECT pg_advisory_xact_lock(hashtext($1), 0)", [`orbital:detection:${kind}`]);
    }
  }

  async bySignal(id: string) {
    const result = await this.client.query<{ payload: OrbitalEvent; digest: string }>(
      `SELECT e.payload, s.digest
         FROM detection_signals s
         JOIN detection_events e ON e.id = s.event_id
        WHERE s.id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? { event: row.payload, digest: String(row.digest) } : null;
  }

  async candidates(kind: SignalKind, time: number, window: number) {
    // Même stratégie que SQLite : les MAX_CANDIDATES plus proches avant et après,
    // puis tri exact par distance et identifiant. Une seule requête réseau.
    const result = await this.client.query<{ payload: OrbitalEvent; anchor: number; id: string }>(
      `SELECT payload, anchor, id FROM (
         SELECT payload, anchor, id FROM detection_events
          WHERE kind = $1 AND anchor BETWEEN $2 AND $3
          ORDER BY anchor DESC, id DESC
          LIMIT $5
       ) AS before
       UNION ALL
       SELECT payload, anchor, id FROM (
         SELECT payload, anchor, id FROM detection_events
          WHERE kind = $1 AND anchor > $3 AND anchor <= $4
          ORDER BY anchor, id
          LIMIT $5
       ) AS after`,
      [kind, time - window, time, time + window, MAX_CANDIDATES],
    );
    return result.rows
      .sort((first, second) => Math.abs(Number(first.anchor) - time) - Math.abs(Number(second.anchor) - time) || first.id.localeCompare(second.id))
      .slice(0, MAX_CANDIDATES)
      .map((row) => row.payload);
  }

  async put(event: OrbitalEvent, anchor: number) {
    // La garde empêche un instantané calculé sur une version ancienne d'écraser une
    // ingestion plus récente. À last_received égal, le dernier écrivain gagne : les
    // deux états sont dérivés du même ensemble de preuves.
    await this.client.query(
      `INSERT INTO detection_events (id, kind, anchor, last_received, payload)
       VALUES ($1, $2, $3, $4::timestamptz, $5::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         kind = EXCLUDED.kind,
         anchor = EXCLUDED.anchor,
         last_received = EXCLUDED.last_received,
         payload = EXCLUDED.payload,
         updated_at = now()
       WHERE EXCLUDED.last_received >= detection_events.last_received`,
      [event.id, event.kind, anchor, event.lastReceivedAt, JSON.stringify(event)],
    );
  }

  async remember(signalId: string, eventId: string, digest: string) {
    await this.client.query(
      `INSERT INTO detection_signals (id, event_id, digest)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET event_id = EXCLUDED.event_id, digest = EXCLUDED.digest`,
      [signalId, eventId, digest],
    );
  }

  async recent(limit: number) {
    const safe = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0;
    if (safe === 0) return [];
    const result = await this.client.query<{ payload: OrbitalEvent }>(
      "SELECT payload FROM detection_events ORDER BY last_received DESC, id LIMIT $1",
      [safe],
    );
    return result.rows.map((row) => row.payload);
  }

  async purge(before: number) {
    // Purge concurrente : on ne bloque jamais sur une ligne qu'une ingestion tient.
    // Les lignes verrouillées seront reprises au prochain passage. La boucle borne la
    // durée de vie de la transaction tout en supprimant les gros arriérés par tranches.
    const batch = 1_000;
    for (let pass = 0; pass < 20; pass++) {
      const result = await this.client.query(
        `DELETE FROM detection_events
          WHERE ctid IN (
            SELECT ctid FROM detection_events
             WHERE anchor < $1
             ORDER BY anchor
             LIMIT $2
             FOR UPDATE SKIP LOCKED
          )`,
        [before, batch],
      );
      if ((result.rowCount ?? 0) < batch) return;
    }
  }
}
