import { expect, it } from "vitest";
import { CameraEngine } from "../src/lib/globe2/camera";
import { toEcef } from "../src/lib/globe2/geo";
import { neighborTile, rootTiles, tilePoint, TileEngine } from "../src/lib/globe2/tiles";
import type { TileId, TileStrategy } from "../src/lib/globe2/tiles";

const SCENARIOS = [
  { name: "SPACE", lat: 20, lon: 0, distance: 50_000_000 },
  { name: "CONTINENT", lat: 48, lon: 10, distance: 6_000_000 },
  { name: "COUNTRY", lat: 46.6, lon: 2.2, distance: 1_400_000 },
  { name: "CITY", lat: 48.8566, lon: 2.3522, distance: 30_000 },
  { name: "DISTRICT", lat: 48.8584, lon: 2.2945, distance: 2_000 },
  { name: "ANTIMERIDIAN", lat: 0, lon: 179.7, distance: 2_000_000 },
  { name: "NORTH_POLE", lat: 89.5, lon: 0, distance: 2_000_000 },
  { name: "OBLIQUE", lat: 45.9, lon: 6.8, distance: 300_000, tilt: 0.8 },
] as const;

/** Reproducible input path; measured CPU times are environment-dependent. */
it("compares both tile indexes under identical Camera Engine scenarios", () => {
  const records = [];
  for (const scenario of SCENARIOS) for (const strategy of ["cube", "geographic"] as const) {
    const camera = new CameraEngine({ width: 1440, height: 900 });
    camera.flyTo({ target: { latDeg: scenario.lat, lonDeg: scenario.lon },
      distanceM: scenario.distance, durationMs: 0 }, 1000, true);
    if ("tilt" in scenario) camera.tilt(scenario.tilt, 1001);
    const tiles = new TileEngine(strategy);
    const initial = tiles.update(camera.getPose(), camera.getViewFootprint());
    let movementChanges = 0, movementCpuMs = 0;
    for (let frame = 0; frame < 24; frame++) {
      camera.orbit(3, 1, 2000 + frame * 16, true);
      const snapshot = tiles.update(camera.getPose(), camera.getViewFootprint());
      movementChanges += snapshot.metrics.changes;
      movementCpuMs += snapshot.metrics.selectionMs;
    }
    records.push({ scenario: scenario.name, strategy, selected: initial.metrics.selected,
      maxDepth: initial.metrics.maxDepth, frustum: initial.metrics.culledFrustum,
      horizon: initial.metrics.culledHorizon, maxSsePx: initial.metrics.maxScreenErrorPx,
      budgetSaturated: initial.metrics.budgetSaturated, coldMs: initial.metrics.selectionMs,
      changes24Frames: movementChanges, meanMoveMs: movementCpuMs / 24 });
    expect(initial.metrics.selected).toBeGreaterThan(0);
    expect(initial.metrics.selected).toBeLessThanOrEqual(256);
    tiles.dispose(); camera.dispose();
  }
  if (process.env.ORBITAL_TILE_BENCHMARK === "1") console.log("TILE_BENCHMARK_JSON=" + JSON.stringify(records));
});

function areaProxy(id: TileId): number {
  const p = (u: number, v: number) => toEcef({ ...tilePoint(id, u, v), heightM: 0, datum: "WGS84" });
  const a = p(0.49, 0.5), b = p(0.51, 0.5), c = p(0.5, 0.49), d = p(0.5, 0.51);
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = d.x - c.x, vy = d.y - c.y, vz = d.z - c.z;
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

it("measures same-level patch distortion and cross-face neighbor frequency", () => {
  const records = [];
  for (const strategy of ["cube", "geographic"] as TileStrategy[]) {
    const areas: number[] = [];
    let crossFaceEdges = 0, edges = 0;
    for (const root of rootTiles(strategy)) for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
      const id = { ...root, z: 3, x, y } as TileId;
      areas.push(areaProxy(id));
      for (const side of ["west", "east", "south", "north"] as const) {
        const neighbor = neighborTile(id, side);
        if (neighbor) { edges++; if (neighbor.face !== id.face) crossFaceEdges++; }
      }
    }
    const ratio = Math.max(...areas) / Math.min(...areas);
    records.push({ strategy, areaProxyRatio: ratio, crossFaceEdges, edges });
    expect(Number.isFinite(ratio)).toBe(true);
  }
  if (process.env.ORBITAL_TILE_BENCHMARK === "1") console.log("TILE_STRUCTURE_JSON=" + JSON.stringify(records));
});
