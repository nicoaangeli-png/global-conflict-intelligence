import "server-only";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import type { ConflictEvent } from "@/types/conflict";
import type { LiveItem } from "@/types/feeds";
import type { DetectionResponse, Signal } from "@/types/detection";
import { DetectionEngine } from "./engine";
import { fromConflict, fromFeed } from "./normalize";
import { SqliteDetectionStore } from "./store";

interface DetectionState { engine: DetectionEngine | null; error: boolean }
const globalRef = globalThis as unknown as { __orbitalDetection?: DetectionState };
const state = globalRef.__orbitalDetection ??= { engine: null, error: false };

function engine(): DetectionEngine {
  return state.engine ??= new DetectionEngine(new SqliteDetectionStore(process.env.ORBITAL_DETECTION_PATH ?? path.join(process.cwd(), "data", "detection.sqlite")));
}

async function ingest(signals: Signal[]) {
  try {
    for (let offset = 0; offset < signals.length; offset += 500) {
      engine().ingest(signals.slice(offset, offset + 500));
      if (offset + 500 < signals.length) await setImmediate();
    }
    state.error = false;
  } catch {
    state.error = true;
    console.warn("[detection] Traitement indisponible ; les flux d'origine restent accessibles.");
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
    const snapshot = engine().snapshot();
    return state.error ? { ...snapshot, status: "unavailable", live: [] } : snapshot;
  } catch {
    return { generatedAt: new Date().toISOString(), events: [], live: [], status: "unavailable" };
  }
}
