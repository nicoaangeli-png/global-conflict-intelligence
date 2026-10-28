import { describe, expect, it } from "vitest";
import { CameraEngine, groundAtNdc } from "../src/lib/globe2/camera";
import { WGS84_A_M, toEcef } from "../src/lib/globe2/geo";
import { TileEngine, behindHorizon, childTiles, neighborTile, outsideFrustum, parentTile,
  rootTiles, tileAt, tileBound, tileKey, tilePoint } from "../src/lib/globe2/tiles";
import type { TileId, TileStrategy } from "../src/lib/globe2/tiles";

function cameraAt(latDeg: number, lonDeg: number, distanceM: number, width = 1440, height = 900) {
  const camera = new CameraEngine({ width, height });
  camera.flyTo({ target: { latDeg, lonDeg }, distanceM, durationMs: 0 }, 1000, true);
  return camera;
}

describe("Globe 2.0 Tile Engine indexing", () => {
  it("has six cube faces and two geographic hemispheres covering global samples", () => {
    expect(rootTiles("cube")).toHaveLength(6);
    expect(rootTiles("geographic")).toHaveLength(2);
    for (const strategy of ["cube", "geographic"] as const) {
      for (const lat of [-90, -80, -45, 0, 45, 80, 90]) for (const lon of [-180, -179.99, -90, 0, 90, 179.99, 180]) {
        const tile = tileAt(strategy, { latDeg: lat, lonDeg: lon }, 6);
        expect(tile.z).toBe(6);
        expect(tile.x).toBeGreaterThanOrEqual(0);
        expect(tile.x).toBeLessThan(64);
        expect(tile.y).toBeGreaterThanOrEqual(0);
        expect(tile.y).toBeLessThan(64);
      }
    }
  });

  it("maintains parent/child identity and nonoverlapping geographic samples", () => {
    for (const strategy of ["cube", "geographic"] as const) for (const root of rootTiles(strategy)) {
      const children = childTiles(root);
      expect(new Set(children.map(tileKey)).size).toBe(4);
      for (const child of children) expect(parentTile(child)).toEqual(root);
      expect(parentTile(root)).toBeNull();
    }
  });

  it("joins cube faces along shared edges and corners", () => {
    const root = rootTiles("cube").find(tile => tile.face === "px")!;
    const east = neighborTile(root, "east")!;
    const north = neighborTile(root, "north")!;
    expect(east.face).not.toBe(root.face);
    expect(north.face).not.toBe(root.face);
    const a = tilePoint(root, 1, 0.5);
    const side = ["west", "east", "south", "north"] as const;
    const nearest = side.flatMap(s => [0, 0.25, 0.5, 0.75, 1].map(t => {
      const p = s === "west" ? tilePoint(east, 0, t) : s === "east" ? tilePoint(east, 1, t) :
        s === "south" ? tilePoint(east, t, 0) : tilePoint(east, t, 1);
      return Math.hypot(p.latDeg - a.latDeg, p.lonDeg - a.lonDeg);
    }));
    expect(Math.min(...nearest)).toBeLessThan(1e-8);
    const corner = tilePoint(root, 1, 1);
    expect(tileAt("cube", corner, 0).face).toMatch(/p[xyz]/);
  });

  it("keeps every cube face edge coincident with its mapped neighbor at depth 2", () => {
    const edge = (id: TileId, side: "west" | "east" | "south" | "north") =>
      [0, 0.25, 0.5, 0.75, 1].map(t => {
        const p = side === "west" ? tilePoint(id, 0, t) : side === "east" ? tilePoint(id, 1, t) :
          side === "south" ? tilePoint(id, t, 0) : tilePoint(id, t, 1);
        return toEcef({ ...p, heightM: 0, datum: "WGS84" });
      });
    for (const root of rootTiles("cube")) for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) {
      const id: TileId = { ...root, z: 2, x, y };
      for (const side of ["west", "east", "south", "north"] as const) {
        const neighbor = neighborTile(id, side)!;
        const candidates = (["west", "east", "south", "north"] as const).flatMap(s => edge(neighbor, s));
        for (const a of edge(id, side)) {
          const gap = Math.min(...candidates.map(b => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)));
          expect(gap).toBeLessThan(1e-6);
        }
      }
    }
  });

  it("wraps the geographic antimeridian and terminates north/south at the poles", () => {
    const seam: TileId = { strategy: "geographic", face: "east", z: 3, x: 7, y: 4 };
    expect(neighborTile(seam, "east")).toEqual({ strategy: "geographic", face: "west", z: 3, x: 0, y: 4 });
    expect(neighborTile({ ...seam, y: 7 }, "north")).toBeNull();
    expect(neighborTile({ ...seam, y: 0 }, "south")).toBeNull();
    expect(tileAt("geographic", { latDeg: 0, lonDeg: 180 }, 3)).toEqual(
      tileAt("geographic", { latDeg: 0, lonDeg: -180 }, 3));
    const wrapped = neighborTile(seam, "east")!;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const a = tilePoint(seam, 1, t), b = tilePoint(wrapped, 0, t);
      const ae = toEcef({ ...a, heightM: 0, datum: "WGS84" });
      const be = toEcef({ ...b, heightM: 0, datum: "WGS84" });
      expect(Math.hypot(ae.x - be.x, ae.y - be.y, ae.z - be.z)).toBeLessThan(1e-6);
    }
  });

  it("returns finite conservative ECEF bounds at poles, seam and deep zoom", () => {
    for (const strategy of ["cube", "geographic"] as const) {
      for (const point of [{ latDeg: 90, lonDeg: 0 }, { latDeg: -90, lonDeg: 179.9 },
        { latDeg: 0, lonDeg: -180 }, { latDeg: 48.8566, lonDeg: 2.3522 }]) {
        const bound = tileBound(tileAt(strategy, point, 12));
        expect([bound.center.x, bound.center.y, bound.center.z, bound.radiusM,
          bound.geometricErrorM].every(Number.isFinite)).toBe(true);
        expect(bound.radiusM).toBeGreaterThan(0);
        expect(bound.geographic.length).toBeGreaterThan(0);
      }
    }
    expect(() => tileAt("cube", { latDeg: NaN, lonDeg: 0 }, 1)).toThrow();
    expect(() => tilePoint(rootTiles("cube")[0], Infinity, 0)).toThrow();
  });
});

describe("Globe 2.0 Tile Engine selection", () => {
  it("selects bounded visible patches deterministically for identical views", () => {
    for (const strategy of ["cube", "geographic"] as const) {
      const camera = cameraAt(46.6, 2.2, 1_400_000);
      const tiles = new TileEngine(strategy);
      const first = tiles.update(camera.getPose(), camera.getViewFootprint());
      const second = tiles.update(camera.getPose(), camera.getViewFootprint());
      expect(first).toBe(second);
      expect(first.selected.length).toBeGreaterThan(0);
      expect(first.selected.length).toBeLessThanOrEqual(256);
      expect(first.metrics.maxDepth).toBeGreaterThan(0);
      expect(first.metrics.selectionMs).toBeGreaterThanOrEqual(0);
      expect(tiles.getLifecycle(first.selected[0])).toBe("visible");
      tiles.dispose(); camera.dispose();
    }
  });

  it("covers sampled ground rays without gaps in space, country, city, oblique and polar views", () => {
    for (const strategy of ["cube", "geographic"] as const) {
      for (const [lat, lon, distance, tilt] of [
        [20, 0, 50_000_000, 0], [46.6, 2.2, 1_400_000, 0],
        [48.8566, 2.3522, 30_000, 0], [45.9, 6.8, 300_000, 0.7],
        [89.5, 0, 2_000_000, 0], [0, 179.7, 2_000_000, 0],
      ]) {
        const camera = cameraAt(lat, lon, distance);
        if (tilt) camera.tilt(tilt, 2000);
        const pose = camera.getPose(), tiles = new TileEngine(strategy);
        const snapshot = tiles.update(pose, camera.getViewFootprint());
        const selected = new Set(snapshot.selected.map(tileKey));
        for (const y of [-0.8, -0.4, 0, 0.4, 0.8]) for (const x of [-0.8, -0.4, 0, 0.4, 0.8]) {
          const hit = groundAtNdc(pose, x, y);
          if (!hit) continue;
          expect(snapshot.selected.some(id => selected.has(tileKey(tileAt(strategy, hit, id.z))) &&
            tileKey(tileAt(strategy, hit, id.z)) === tileKey(id)),
          `${strategy} ${lat}/${lon} ${distance} at ${x}/${y}`).toBe(true);
        }
        tiles.dispose(); camera.dispose();
      }
    }
  });

  it("culls truly opposite local patches behind the ellipsoid or frustum", () => {
    const camera = cameraAt(0, 0, 30_000);
    const pose = camera.getPose();
    const behind = tileBound(tileAt("cube", { latDeg: 0, lonDeg: 180 }, 8));
    expect(behindHorizon(pose, behind)).toBe(true);
    const sideways = tileBound(tileAt("cube", { latDeg: 0, lonDeg: 90 }, 8));
    expect(outsideFrustum(pose, sideways) || behindHorizon(pose, sideways)).toBe(true);
    const front = tileBound(tileAt("cube", { latDeg: 0, lonDeg: 0 }, 8));
    expect(outsideFrustum(pose, front)).toBe(false);
    expect(behindHorizon(pose, front)).toBe(false);
    camera.dispose();
  });

  it("changes refinement with viewport and FOV without changing the world position", () => {
    const camera = cameraAt(48, 2, 300_000, 390, 844);
    const tiles = new TileEngine("cube");
    const first = tiles.update(camera.getPose(), camera.getViewFootprint());
    camera.setViewport({ width: 1440, height: 1440 });
    camera.setVerticalFov(30 * Math.PI / 180);
    const second = tiles.update(camera.getPose(), camera.getViewFootprint());
    expect(second.revision).not.toBe(first.revision);
    expect(second.selected.map(tileKey)).not.toEqual(first.selected.map(tileKey));
    tiles.dispose(); camera.dispose();
  });

  it("survives oblique, pole, antimeridian and floating-origin rebase", () => {
    const camera = cameraAt(89.5, 179.7, 2_000_000);
    const tiles = new TileEngine("cube");
    const first = tiles.update(camera.getPose(), camera.getViewFootprint());
    camera.tilt(0.6, 2000);
    const oblique = tiles.update(camera.getPose(), camera.getViewFootprint());
    expect(oblique.selected.length).toBeGreaterThan(0);
    camera.flyTo({ target: { latDeg: 0, lonDeg: -179.7 }, distanceM: 30_000, durationMs: 0 }, 3000, true);
    const rebased = tiles.update(camera.getPose(), camera.getViewFootprint());
    expect(rebased.originEpoch).toBeGreaterThanOrEqual(first.originEpoch);
    expect(rebased.selected.length).toBeGreaterThan(0);
    expect(rebased.selected.every(id => Number.isFinite(tiles.getBound(id).radiusM))).toBe(true);
    tiles.dispose(); camera.dispose();
  });

  it("keeps LOD stable under tiny camera changes and resets on strategy switch", () => {
    const camera = cameraAt(46.6, 2.2, 1_400_000);
    const tiles = new TileEngine("cube", { hysteresis: 0.2 });
    const first = tiles.update(camera.getPose(), camera.getViewFootprint());
    camera.orbit(0.01, 0.01, 2000, true);
    const second = tiles.update(camera.getPose(), camera.getViewFootprint());
    expect(second.metrics.changes).toBeLessThan(first.metrics.selected / 3);
    expect(second.metrics.subdivisions).toBeLessThan(first.metrics.subdivisions);
    tiles.setStrategy("geographic");
    const third = tiles.update(camera.getPose(), camera.getViewFootprint());
    expect(third.strategy).toBe("geographic");
    expect(third.visible.every(id => id.strategy === "geographic")).toBe(true);
    tiles.dispose(); camera.dispose();
  });

  it("does not toggle parent/children under repeated small zoom reversals", () => {
    for (const strategy of ["cube", "geographic"] as const) {
      const camera = cameraAt(46.6, 2.2, 1_400_000);
      const tiles = new TileEngine(strategy, { hysteresis: 0.2 });
      tiles.update(camera.getPose(), camera.getViewFootprint());
      let changes = 0;
      for (let i = 0; i < 20; i++) {
        camera.flyTo({ target: { latDeg: 46.6, lonDeg: 2.2 },
          distanceM: i % 2 === 0 ? 1_400_700 : 1_399_300, durationMs: 0 }, 3000 + i, true);
        changes += tiles.update(camera.getPose(), camera.getViewFootprint()).metrics.changes;
      }
      expect(changes).toBeLessThan(20);
      tiles.dispose(); camera.dispose();
    }
  });

  it("does not depend on a fake terrain altitude", () => {
    const ecef = toEcef({ latDeg: 0, lonDeg: 0, heightM: 0, datum: "WGS84" });
    expect(Math.hypot(ecef.x, ecef.y, ecef.z)).toBeCloseTo(WGS84_A_M, 4);
    expect(tileBound(rootTiles("cube")[0]).radiusM).toBeGreaterThan(0);
  });
});
