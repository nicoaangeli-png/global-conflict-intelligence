import "server-only";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import type { ConflictEvent } from "@/types/conflict";
import type { LiveItem } from "@/types/feeds";
import type { DetectionResponse, Signal } from "@/types/detection";
import { increment } from "@/server/observability/metrics";
import { log } from "@/server/observability/logger";
import { DetectionEngine } from "./engine";
import { fromConflict, fromFeed } from "./normalize";
import { PostgresDetectionStore } from "./postgresStore";
import { SqliteDetectionStore, type DetectionStore } from "./store";

interface DetectionState { engine: DetectionEngine | null; error: boolean; backend: "sqlite" | "postgres" | null }
const globalRef = globalThis as unknown as { __orbitalDetection?: DetectionState };
const state = globalRef.__orbitalDetection ??= { engine: null, error: false, backend: null };

/**
 * Sélection du backend, sans bascule silencieuse :
 *  - `ORBITAL_DETECTION_STORAGE=postgres` : PostgreSQL, `DATABASE_URL` obligatoire ;
 *  - `ORBITAL_DETECTION_STORAGE=sqlite` : SQLite local, même si `DATABASE_URL` existe
 *    (échappatoire pendant une migration volontaire de données) ;
 *  - `auto` (défaut) : PostgreSQL si `DATABASE_URL` est défini, sinon SQLite.
 *
 * Une erreur PostgreSQL ne retombe jamais sur SQLite : en multi-instance, un repli
 * silencieux créerait deux états divergents. Le snapshot renvoie alors `unavailable`.
 */
export function detectionBackend(): "sqlite" | "postgres" {
  const mode = (process.env.ORBITAL_DETECTION_STORAGE ?? "auto").trim().toLowerCase();
  if (mode !== "auto" && mode !== "sqlite" && mode !== "postgres") {
    throw new Error("ORBITAL_DETECTION_STORAGE doit valoir auto, sqlite ou postgres");
  }
  if (mode === "sqlite") return "sqlite";
  if (mode === "postgres" || process.env.DATABASE_URL?.trim()) return "postgres";
  return "sqlite";
}

function createStore(): DetectionStore {
  const backend = detectionBackend();
  state.backend = backend;
  if (backend === "postgres") {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) throw new Error("ORBITAL_DETECTION_STORAGE=postgres exige DATABASE_URL");
    return new PostgresDetectionStore(url);
  }
  return new SqliteDetectionStore(process.env.ORBITAL_DETECTION_PATH ?? path.join(process.cwd(), "data", "detection.sqlite"));
}

function engine(): DetectionEngine {
  return state.engine ??= new DetectionEngine(createStore());
}

async function ingest(signals: Signal[]) {
  try {
    for (let offset = 0; offset < signals.length; offset += 500) {
      await engine().ingest(signals.slice(offset, offset + 500));
      if (offset + 500 < signals.length) await setImmediate();
    }
    state.error = false;
  } catch {
    // Jamais de détail de connexion ni d'URL dans les logs ou la réponse HTTP.
    state.error = true;
    log("warn", "detection_failed", { subsystem: "detection" });
  }
}

export async function ingestFeedSignals(items: LiveItem[]): Promise<void> {
  await ingest(items.map(fromFeed).filter((signal): signal is Signal => signal !== null));
}

export async function ingestConflictSignals(items: ConflictEvent[]): Promise<void> {
  const receivedAt = new Date().toISOString();
  await ingest(items.map((item) => fromConflict(item, receivedAt)).filter((signal): signal is Signal => signal !== null));
}

export async function getDetectionSnapshot(): Promise<DetectionResponse> {
  try {
    const snapshot = await engine().snapshot();
    return state.error ? { ...snapshot, status: "unavailable", live: [] } : snapshot;
  } catch {
    increment("detection_errors_total");
    log("warn", "detection_failed", { subsystem: "detection" });
    return { generatedAt: new Date().toISOString(), events: [], live: [], status: "unavailable" };
  }
}
