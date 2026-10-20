import type { SensorType } from "@/types/coverage";

/**
 * Mémoire agrégée des positions reçues, par capteur, pour estimer la couverture.
 *
 * On ne garde AUCUNE position individuelle : seulement des compteurs par minute de
 * réception et par cellule de grille de 5° × 5°, plus des moyennes horaires sur 24 h
 * (référence « habituelle »). Mémoire bornée quel que soit le débit AIS.
 *
 * L'AIS enregistre tous les navires reçus (pas seulement militaires) : c'est le
 * meilleur indicateur disponible de la présence de récepteurs. L'ADS-B enregistre les
 * aéronefs de `/v2/mil`, seule donnée aérienne collectée en continu.
 */

export const CELL_DEG = 5;
export const GRID_COLS = 360 / CELL_DEG;
export const GRID_ROWS = 180 / CELL_DEG;
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
/** Minutes détaillées conservées (au-delà de la plus longue fenêtre d'analyse). */
export const MINUTES_KEPT = 60;
/** Heures conservées pour la référence habituelle. */
export const HOURS_KEPT = 24;

export interface CellMinute {
  positions: number;
  /** Positions dont le délai de transmission est connu et court. */
  fresh: number;
  /** Positions dont le délai de transmission est connu. */
  lagKnown: number;
  /** Émetteurs distincts (calculé à la clôture de la minute). */
  emitters: number;
  newestObservedMs: number;
  ids: Set<string> | null;
}

export interface MinuteBucket {
  minute: number;
  cells: Map<number, CellMinute>;
  closed: boolean;
}

export interface HourBucket {
  hour: number;
  /** Minutes de cette heure où le capteur a reçu au moins une position. */
  activeMinutes: number;
  /** Somme, sur les minutes actives, des émetteurs distincts par cellule. */
  emitterMinutes: Map<number, number>;
}

export interface SensorStore {
  minutes: Map<number, MinuteBucket>;
  hours: Map<number, HourBucket>;
  firstObservationMs: number | null;
}

export interface Observation {
  id: string;
  lat: number;
  lon: number;
  /** Date de la position (émission), si connue ; sinon date de réception. */
  observedAtMs: number;
  /** Date de réception par ORBITAL. */
  receivedAtMs: number;
  /** Délai émission → réception (ms) ; null si la source ne le publie pas. */
  lagMs: number | null;
}

const GLOBAL_KEY = "__orbitalSensorCoverageV1";

type Stores = Record<SensorType, SensorStore>;

function newStore(): SensorStore {
  return { minutes: new Map(), hours: new Map(), firstObservationMs: null };
}

function stores(): Stores {
  const global = globalThis as unknown as Record<string, Stores | undefined>;
  return (global[GLOBAL_KEY] ??= { adsb: newStore(), ais: newStore() });
}

export function sensorStore(sensor: SensorType): SensorStore {
  return stores()[sensor];
}

/** Réservé aux tests. */
export function clearCoverageObservations(): void {
  const all = stores();
  all.adsb = newStore();
  all.ais = newStore();
}

export function cellOf(lat: number, lon: number): number {
  const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor((lat + 90) / CELL_DEG)));
  const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor((lon + 180) / CELL_DEG)));
  return row * GRID_COLS + col;
}

/** Cellules recouvrant un rectangle [minLon, minLat, maxLon, maxLat] (antiméridien géré). */
export function cellsInBox(minLon: number, minLat: number, maxLon: number, maxLat: number): Set<number> {
  const cells = new Set<number>();
  const rowFrom = cellOf(minLat, 0) / GRID_COLS | 0;
  const rowTo = cellOf(maxLat, 0) / GRID_COLS | 0;
  const spans: [number, number][] = minLon <= maxLon ? [[minLon, maxLon]] : [[minLon, 180], [-180, maxLon]];
  for (const [from, to] of spans) {
    const colFrom = cellOf(0, from) % GRID_COLS;
    const colTo = cellOf(0, to) % GRID_COLS;
    for (let row = rowFrom; row <= rowTo; row++) for (let col = colFrom; col <= colTo; col++) cells.add(row * GRID_COLS + col);
  }
  return cells;
}

/** Cellule du point et ses voisines immédiates (≈ 15° × 15°). */
export function cellsAround(lat: number, lon: number): Set<number> {
  const center = cellOf(lat, lon);
  const row = Math.floor(center / GRID_COLS);
  const col = center % GRID_COLS;
  const cells = new Set<number>();
  for (let dr = -1; dr <= 1; dr++) {
    const r = row + dr;
    if (r < 0 || r >= GRID_ROWS) continue;
    for (let dc = -1; dc <= 1; dc++) cells.add(r * GRID_COLS + ((col + dc + GRID_COLS) % GRID_COLS));
  }
  return cells;
}

function closeMinute(store: SensorStore, bucket: MinuteBucket): void {
  if (bucket.closed) return;
  bucket.closed = true;
  const hourId = Math.floor((bucket.minute * MINUTE_MS) / HOUR_MS);
  let hour = store.hours.get(hourId);
  if (!hour) {
    hour = { hour: hourId, activeMinutes: 0, emitterMinutes: new Map() };
    store.hours.set(hourId, hour);
  }
  hour.activeMinutes++;
  for (const [cell, data] of bucket.cells) {
    data.emitters = data.ids?.size ?? data.emitters;
    data.ids = null;
    hour.emitterMinutes.set(cell, (hour.emitterMinutes.get(cell) ?? 0) + data.emitters);
  }
}

/**
 * Clôt les minutes terminées (les émetteurs distincts deviennent un simple nombre)
 * et oublie ce qui sort des fenêtres conservées. Appelé à l'ingestion et à la lecture.
 */
export function maintain(store: SensorStore, nowMs: number): void {
  const currentMinute = Math.floor(nowMs / MINUTE_MS);
  for (const bucket of store.minutes.values()) {
    if (bucket.minute < currentMinute) closeMinute(store, bucket);
    if (bucket.minute <= currentMinute - MINUTES_KEPT) store.minutes.delete(bucket.minute);
  }
  const currentHour = Math.floor(nowMs / HOUR_MS);
  for (const hour of store.hours.keys()) if (hour <= currentHour - HOURS_KEPT) store.hours.delete(hour);
}

export function recordObservation(sensor: SensorType, observation: Observation, freshLagMs: number): void {
  const { id, lat, lon, observedAtMs, receivedAtMs, lagMs } = observation;
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
  if (!Number.isFinite(observedAtMs) || !Number.isFinite(receivedAtMs)) return;
  const store = sensorStore(sensor);
  const minute = Math.floor(receivedAtMs / MINUTE_MS);
  let bucket = store.minutes.get(minute);
  if (!bucket) {
    maintain(store, receivedAtMs);
    bucket = { minute, cells: new Map(), closed: false };
    store.minutes.set(minute, bucket);
  }
  const cell = cellOf(lat, lon);
  let data = bucket.cells.get(cell);
  if (!data) {
    data = { positions: 0, fresh: 0, lagKnown: 0, emitters: 0, newestObservedMs: Number.NEGATIVE_INFINITY, ids: new Set() };
    bucket.cells.set(cell, data);
  }
  data.positions++;
  if (lagMs !== null && Number.isFinite(lagMs)) {
    data.lagKnown++;
    if (lagMs <= freshLagMs) data.fresh++;
  }
  if (observedAtMs > data.newestObservedMs) data.newestObservedMs = observedAtMs;
  if (data.ids) data.ids.add(id);
  else data.emitters++;
  if (store.firstObservationMs === null || receivedAtMs < store.firstObservationMs) store.firstObservationMs = receivedAtMs;
}
