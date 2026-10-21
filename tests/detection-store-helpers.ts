import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import type { OrbitalEvent, Signal } from "@/types/detection";
import { DetectionEngine } from "@/server/detection/engine";
import { PostgresDetectionStore } from "@/server/detection/postgresStore";
import { SqliteDetectionStore, type DetectionStore } from "@/server/detection/store";

export const NOW = Date.parse("2026-10-21T12:00:00Z");

export function signal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: "signal-0", provider: "provider-0", sourceName: "Source 0",
    url: "https://provider-0.example/article", title: "Explosion au terminal Neptune du port Odessa",
    text: null, kind: "explosion", nature: "press", occurredAt: new Date(NOW).toISOString(),
    publishedAt: null, receivedAt: new Date(NOW).toISOString(),
    position: { lat: 46.48, lon: 30.73, precision: "city" }, place: "Odessa", countries: ["UKR"],
    entities: ["terminal Neptune"], upstreamAgency: null, confirmsOccurrence: false,
    severity: null, metric: null, caveat: "Fixture synthétique, pas un événement réel", ...overrides,
  };
}

export function distinct(index: number, overrides: Partial<Signal> = {}): Signal {
  return signal({
    id: `signal-${index}`,
    provider: `provider-${index}`,
    sourceName: `Source ${index}`,
    url: `https://provider-${index}.example/article`,
    ...overrides,
  });
}

/** Événement minimal pour tester le store sans passer par le moteur. */
export function event(id: string, lastReceivedAt = new Date(NOW).toISOString(), title = id): OrbitalEvent {
  return {
    id, title, kind: "explosion", firstReceivedAt: lastReceivedAt, lastReceivedAt,
    occurredAt: null, position: null, place: null, countries: [], evidence: [],
    confidenceScore: 0,
    confidence: { score: 0, status: "signal", factors: [], confirmationBasis: null, caveats: [], version: 1 },
    importanceScore: 0, importanceReasons: [], status: "signal", independentSourceCount: 0,
    distinctProviderCount: 0, evidenceCount: 0, contradictions: [], timeline: [], evidenceTruncated: false,
  };
}

export interface StoreContext {
  store: DetectionStore;
  engine: DetectionEngine;
  reopen(): Promise<DetectionStore>;
  cleanup(): Promise<void>;
}

export async function sqliteContext(): Promise<StoreContext> {
  const directory = mkdtempSync(path.join(os.tmpdir(), "orbital-detection-contract-"));
  const filename = path.join(directory, "detection.sqlite");
  const stores: DetectionStore[] = [];
  let store = new SqliteDetectionStore(filename);
  stores.push(store);
  return {
    get store() { return store; },
    get engine() { return new DetectionEngine(store); },
    async reopen() {
      store = new SqliteDetectionStore(filename);
      stores.push(store);
      return store;
    },
    async cleanup() {
      for (const opened of stores.splice(0)) await opened.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

let pgSchemaCounter = 0;

/** Schéma PostgreSQL isolé : les tests PostgreSQL ne touchent jamais public. */
export async function postgresContext(url: string): Promise<StoreContext & { schema: string; maintenance: Pool }> {
  const schema = `detection_test_${process.pid}_${++pgSchemaCounter}_${Date.now().toString(36)}`.slice(0, 60);
  const maintenance = new Pool({ connectionString: url, max: 2 });
  await maintenance.query(`CREATE SCHEMA "${schema}"`);
  const stores: PostgresDetectionStore[] = [];
  let store = new PostgresDetectionStore({ connectionString: url, schema });
  stores.push(store);
  return {
    schema,
    maintenance,
    get store() { return store; },
    get engine() { return new DetectionEngine(store); },
    async reopen() {
      store = new PostgresDetectionStore({ connectionString: url, schema });
      stores.push(store);
      return store;
    },
    async cleanup() {
      for (const opened of stores.splice(0)) await opened.close();
      await maintenance.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => undefined);
      await maintenance.end();
    },
  };
}
