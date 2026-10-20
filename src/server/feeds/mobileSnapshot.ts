import fs from "node:fs";
import path from "node:path";
import { exportAdsbTracks, importAdsbTracks, type AircraftTrackRecord } from "./military";
import { exportMaritime, importMaritime, type MaritimeSnapshot } from "./maritime";

/**
 * Sauvegarde périodique des trajets observés (avions ADS-B, navires AIS) :
 * un redémarrage du service ne les efface plus. Seules des positions réellement
 * reçues sont écrites ; les fenêtres de rétention (3 h, 6 h, 2 h) s'appliquent au retour.
 */

const SNAPSHOT_VERSION = 1;
const SAVE_EVERY_MS = 60_000;
const GLOBAL_KEY = "__orbitalMobileSnapshotV1";

interface Snapshot {
  version: number;
  savedAt: string;
  adsb: [string, AircraftTrackRecord][];
  maritime: MaritimeSnapshot;
}

const snapshotFile = () => process.env.ORBITAL_MOBILES_SNAPSHOT ?? path.join(process.cwd(), "data", "mobiles", "snapshot.json");

export function restoreMobileSnapshot(file = snapshotFile(), nowMs = Date.now()): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Snapshot>;
    if (raw.version !== SNAPSHOT_VERSION) return false;
    if (Array.isArray(raw.adsb)) importAdsbTracks(raw.adsb, nowMs);
    if (raw.maritime) importMaritime(raw.maritime, nowMs);
    return true;
  } catch {
    return false; // absent ou illisible : on repart de zéro
  }
}

export function saveMobileSnapshot(file = snapshotFile(), now = new Date()): void {
  const snapshot: Snapshot = { version: SNAPSHOT_VERSION, savedAt: now.toISOString(), adsb: exportAdsbTracks(), maritime: exportMaritime() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot));
  fs.renameSync(tmp, file);
}

/** Au premier appel (hors tests) : restaure la dernière sauvegarde puis sauvegarde chaque minute. */
export function ensureMobileSnapshots(): void {
  if (process.env.NODE_ENV === "test") return;
  const global = globalThis as unknown as Record<string, boolean | undefined>;
  if (global[GLOBAL_KEY]) return;
  global[GLOBAL_KEY] = true;
  restoreMobileSnapshot();
  const timer = setInterval(() => {
    try {
      saveMobileSnapshot();
    } catch {
      // disque indisponible : nouvel essai à la prochaine minute
    }
  }, SAVE_EVERY_MS);
  (timer as unknown as { unref?: () => void }).unref?.();
}
