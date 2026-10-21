import type { CoverageResponse, CoverageScope, SensorType } from "@/types/coverage";
import type { SourceHealthStatus } from "@/types/health";
import { COVERAGE_HELP } from "@/lib/coverage";
import { getSourceHealth } from "@/server/health/registry";
import { countryAt, type WorldIndex } from "@/lib/geo/world";
import { CELL_DEG, GRID_COLS, cellsAround, cellsInBox, sensorStore } from "./observations";
import { ADSB_PARAMS, AIS_PARAMS, computeCoverage, type SourceAvailability } from "./score";

export { ADSB_PARAMS, AIS_PARAMS, CAPS, LEVEL_THRESHOLDS, computeCoverage, levelFromScore } from "./score";
export { clearCoverageObservations, recordObservation } from "./observations";

/** Source de chaque capteur dans le registre de santé. */
const SENSOR_SOURCE: Record<SensorType, string> = {
  adsb: "feed:adsb-lol-military",
  ais: "feed:aisstream-military",
};

export function sourceAvailability(status: SourceHealthStatus | null | undefined): SourceAvailability {
  if (status === "unavailable" || status === "unconfigured") return "unavailable";
  if (status === "stale") return "failing";
  if (status === "healthy" || status === "degraded") return "ok";
  return "pending";
}

export type CoverageQuery =
  | { kind: "global" }
  | { kind: "country"; iso: string; cells: Set<number> }
  | { kind: "point"; lat: number; lon: number; id?: string };

const countryCellsCache = new Map<string, Set<number>>();

/**
 * Cellules de 5° touchant réellement le territoire (échantillonnage tous les 1°), et non
 * son rectangle englobant : celui de la France inclut la Guyane, donc la moitié de l'Atlantique.
 */
export function countryCoverageCells(world: WorldIndex, iso: string): Set<number> | null {
  const cached = countryCellsCache.get(iso);
  if (cached) return cached;
  const entry = world.byIso.get(iso);
  if (!entry) return null;
  const candidates = cellsInBox(...entry.bbox);
  const cells = new Set<number>();
  for (const cell of candidates) {
    const lat0 = -90 + Math.floor(cell / GRID_COLS) * CELL_DEG;
    const lon0 = -180 + (cell % GRID_COLS) * CELL_DEG;
    search: for (let i = 0; i < CELL_DEG; i++) {
      for (let j = 0; j < CELL_DEG; j++) {
        if (countryAt(world, lat0 + i + 0.5, lon0 + j + 0.5)?.iso === iso) {
          cells.add(cell);
          break search;
        }
      }
    }
  }
  // Territoire plus fin que l'échantillonnage : on garde son rectangle (petit par construction).
  const result = cells.size ? cells : candidates;
  countryCellsCache.set(iso, result);
  return result;
}

export function coverageFor(query: CoverageQuery, nowMs = Date.now()): CoverageResponse {
  let cells: Set<number> | null = null;
  let scope: CoverageScope = { kind: "global", id: null, cells: null };
  if (query.kind === "country") {
    cells = query.cells;
    scope = { kind: "country", id: query.iso, cells: cells.size };
  } else if (query.kind === "point") {
    cells = cellsAround(query.lat, query.lon);
    scope = { kind: "point", id: query.id ?? `${query.lat.toFixed(1)},${query.lon.toFixed(1)}`, cells: cells.size };
  }
  const sensor = (type: SensorType) =>
    computeCoverage({
      store: sensorStore(type),
      params: type === "adsb" ? ADSB_PARAMS : AIS_PARAMS,
      cells,
      nowMs,
      source: sourceAvailability(getSourceHealth(SENSOR_SOURCE[type], nowMs)?.status),
    });
  return { generatedAt: new Date(nowMs).toISOString(), scope, adsb: sensor("adsb"), ais: sensor("ais"), note: COVERAGE_HELP.fr };
}
