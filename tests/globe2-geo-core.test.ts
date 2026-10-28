import { describe, expect, it } from "vitest";
import {
  WGS84_A_M, WGS84_B_M, bboxContains, bboxIntersects, chordDistanceMeters,
  createFloatingOrigin, ecefToEnu, ecefToRender, enuFrame, enuToEcef, fromEcef,
  geodesicDistance, isOccludedByEllipsoid, normalizeBBox, normalizeLongitude,
  rayEllipsoidIntersection, rebaseFloatingOrigin, renderToEcef, resolveSourcePosition,
  splitBBox, toEcef,
} from "@/lib/globe2/geo";
import type { EcefMeters, GeoPoint, SourceGeoPoint } from "@/lib/globe2/geo";

const point = (latDeg: number, lonDeg: number, heightM = 0): GeoPoint =>
  ({ latDeg, lonDeg, heightM, datum: "WGS84" });
const norm = (v: EcefMeters): number => Math.hypot(v.x, v.y, v.z);

describe("source height and WGS84", () => {
  it("resolves only known ellipsoidal heights with provenance", () => {
    const base: SourceGeoPoint = { latDeg: 0, lonDeg: 0, heightM: 0, verticalDatum: "WGS84_ELLIPSOID" };
    expect(resolveSourcePosition(base, "api/camera/1")).toEqual({
      status: "resolved", point: point(0, 0), method: "source-ellipsoid", provenance: "api/camera/1",
    });
    expect(resolveSourcePosition({ ...base, heightM: null }, "api")).toEqual({ status: "unresolved", reason: "missing-height" });
    for (const datum of ["MSL", "AGL"] as const) {
      expect(resolveSourcePosition({ ...base, verticalDatum: datum }, "api")).toEqual({ status: "unresolved", reason: "missing-model" });
    }
    expect(resolveSourcePosition({ ...base, verticalDatum: "UNKNOWN" }, "api")).toEqual({ status: "unresolved", reason: "unknown-datum" });
    expect(resolveSourcePosition({ ...base, latDeg: NaN }, "api")).toEqual({ status: "unresolved", reason: "invalid-position" });
    expect(resolveSourcePosition({ ...base, heightM: Infinity }, "api")).toEqual({ status: "unresolved", reason: "invalid-position" });
  });

  it("maps equator, Greenwich and both poles to the correct axes", () => {
    expect(toEcef(point(0, 0))).toEqual({ x: WGS84_A_M, y: 0, z: 0 });
    expect(toEcef(point(0, 90)).y).toBeCloseTo(WGS84_A_M, 6);
    expect(toEcef(point(90, 0)).z).toBeCloseTo(WGS84_B_M, 6);
    expect(toEcef(point(-90, 0)).z).toBeCloseTo(-WGS84_B_M, 6);
    expect(fromEcef({ x: 0, y: 0, z: WGS84_B_M })).toEqual(point(90, 0));
    expect(fromEcef({ x: 0, y: 0, z: -WGS84_B_M })).toEqual(point(-90, 0));
  });

  it("rejects invalid finite bounds, datums and the Earth centre", () => {
    for (const invalid of [point(NaN, 0), point(91, 0), point(0, 180), point(0, 0, Infinity)]) {
      expect(() => toEcef(invalid)).toThrow(RangeError);
    }
    expect(() => fromEcef({ x: 0, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => fromEcef({ x: Infinity, y: 0, z: 0 })).toThrow(RangeError);
  });

  it("round-trips ordinary, polar, antimeridian, underground and high-altitude positions", () => {
    const cases = [point(0, 0), point(45.4, 7.2, 2400), point(-33.9, 151.2, -500),
      point(89.999999, -179.99999, 100), point(-89.999999, 179.9, 0),
      point(10, -180, 35_786_000), point(90, 0, 1000)];
    for (const original of cases) {
      const recovered = fromEcef(toEcef(original));
      expect(chordDistanceMeters(toEcef(original), toEcef(recovered))).toBeLessThan(0.01);
      expect(Math.abs(recovered.heightM - original.heightM)).toBeLessThan(0.01);
    }
  });

  it("measures deterministic conversion error over 10,000 ordinary positions", () => {
    let maxPositionErrorM = 0, maxHeightErrorM = 0;
    for (let i = 0; i < 10_000; i++) {
      const original = point(-85 + (i * 137.507764) % 170, -180 + (i * 91.731) % 360, -500 + (i * 17.31) % 13_000);
      const recovered = fromEcef(toEcef(original));
      maxPositionErrorM = Math.max(maxPositionErrorM, chordDistanceMeters(toEcef(original), toEcef(recovered)));
      maxHeightErrorM = Math.max(maxHeightErrorM, Math.abs(recovered.heightM - original.heightM));
    }
    console.info(`Geo Core WGS84 10000 points: max position error ${maxPositionErrorM} m; max height error ${maxHeightErrorM} m`);
    expect(maxPositionErrorM).toBeLessThanOrEqual(0.01);
    expect(maxHeightErrorM).toBeLessThanOrEqual(0.01);
  });
});

describe("ENU and geometry", () => {
  it("provides orthonormal, right-handed East/North/Up axes at equator and pole", () => {
    for (const anchor of [point(0, 0), point(45, 120), point(90, -60)]) {
      const f = enuFrame(anchor);
      const dot = (a: EcefMeters, b: EcefMeters) => a.x * b.x + a.y * b.y + a.z * b.z;
      for (const axis of [f.east, f.north, f.up]) expect(norm(axis)).toBeCloseTo(1, 12);
      expect(dot(f.east, f.north)).toBeCloseTo(0, 12);
      expect(dot(f.east, f.up)).toBeCloseTo(0, 12);
      expect(dot(f.north, f.up)).toBeCloseTo(0, 12);
      const cross = { x: f.east.y * f.north.z - f.east.z * f.north.y,
        y: f.east.z * f.north.x - f.east.x * f.north.z,
        z: f.east.x * f.north.y - f.east.y * f.north.x };
      expect(dot(cross, f.up)).toBeCloseTo(1, 12);
      const local = { east: 100, north: -200, up: 50 };
      const restored = ecefToEnu(enuToEcef(local, f), f);
      expect(restored.east).toBeCloseTo(local.east, 7);
      expect(restored.north).toBeCloseTo(local.north, 7);
      expect(restored.up).toBeCloseTo(local.up, 7);
    }
    expect(enuFrame(point(0, 0)).east).toEqual({ x: -0, y: 1, z: 0 });
  });

  it("uses ellipsoidal geodesic distance and reports antipodal non-convergence", () => {
    const d = geodesicDistance(point(0, 0), point(0, 1));
    expect(d.status).toBe("converged");
    if (d.status === "converged") expect(d.distanceM).toBeCloseTo(111_319.490793, 3);
    const seam = geodesicDistance(point(0, 179), point(0, -179));
    expect(seam.status).toBe("converged");
    if (seam.status === "converged") expect(seam.distanceM).toBeCloseTo(222_638.981586, 3);
    const pole = geodesicDistance(point(90, 0), point(90, 120));
    expect(pole.status).toBe("converged");
    if (pole.status === "converged") expect(pole.distanceM).toBeLessThan(0.001);
    expect(geodesicDistance(point(0, 0), point(0, -179.9999)).status).toBe("non-convergent");
  });
});

describe("bbox and antimeridian", () => {
  it("normalizes longitudes and splits wrapped bboxes", () => {
    expect(normalizeLongitude(180)).toBe(-180);
    expect(normalizeLongitude(-540)).toBe(-180);
    const wrapped = normalizeBBox({ westDeg: 170, southDeg: -10, eastDeg: 190, northDeg: 10 });
    expect(wrapped).toEqual({ westDeg: 170, southDeg: -10, eastDeg: -170, northDeg: 10 });
    expect(splitBBox(wrapped)).toEqual([
      { westDeg: 170, southDeg: -10, eastDeg: 180, northDeg: 10 },
      { westDeg: -180, southDeg: -10, eastDeg: -170, northDeg: 10 },
    ]);
    expect(bboxContains(wrapped, 0, 179)).toBe(true);
    expect(bboxContains(wrapped, 0, -179)).toBe(true);
    expect(bboxContains(wrapped, 0, 0)).toBe(false);
    expect(bboxIntersects(wrapped, { westDeg: -179, eastDeg: -175, southDeg: 0, northDeg: 5 })).toBe(true);
    expect(bboxIntersects(wrapped, { westDeg: -50, eastDeg: -40, southDeg: 0, northDeg: 5 })).toBe(false);
  });

  it("handles polar caps, the full globe and invalid bounds", () => {
    const cap = { westDeg: -180, eastDeg: 180, southDeg: 85, northDeg: 90 };
    expect(bboxContains(cap, 90, 45)).toBe(true);
    expect(bboxIntersects(cap, { westDeg: 100, eastDeg: 120, southDeg: 89, northDeg: 90 })).toBe(true);
    expect(bboxContains({ westDeg: 170, eastDeg: -170, southDeg: 85, northDeg: 90 }, 90, 0)).toBe(true);
    expect(bboxIntersects({ westDeg: 170, eastDeg: -170, southDeg: 85, northDeg: 90 },
      { westDeg: -20, eastDeg: 20, southDeg: 85, northDeg: 90 })).toBe(true);
    expect(normalizeBBox({ westDeg: -180, eastDeg: 180, southDeg: -90, northDeg: 90 })).toEqual({
      westDeg: -180, eastDeg: 180, southDeg: -90, northDeg: 90,
    });
    expect(() => splitBBox({ westDeg: 0, eastDeg: 1, southDeg: 91, northDeg: 92 })).toThrow(RangeError);
    expect(() => normalizeBBox({ westDeg: 0, eastDeg: NaN, southDeg: 0, northDeg: 1 })).toThrow(RangeError);
  });
});

describe("floating origin, horizon and ray", () => {
  it("keeps world positions invariant and rejects stale epochs after rebase", () => {
    const world = toEcef(point(48.8584, 2.2945, 100));
    const origin = createFloatingOrigin(toEcef(point(48.8584, 2.2945)));
    const relative = ecefToRender(world, origin);
    expect(chordDistanceMeters(renderToEcef(relative, origin), world)).toBeLessThan(1e-8);
    const next = rebaseFloatingOrigin(origin, toEcef(point(48.8585, 2.2946)));
    expect(next.originEpoch).toBe(1);
    expect(chordDistanceMeters(renderToEcef(ecefToRender(world, next), next), world)).toBeLessThan(1e-8);
    expect(() => renderToEcef(relative, next)).toThrow("Stale");
    expect(rebaseFloatingOrigin(next, next.origin)).toBe(next);
  });

  it("intersects the ellipsoid, misses away from it and detects back-side occlusion", () => {
    const eye = { x: WGS84_A_M + 1000, y: 0, z: 0 };
    const hit = rayEllipsoidIntersection(eye, { x: -1, y: 0, z: 0 });
    expect(hit).not.toBeNull();
    expect(hit!.nearT).toBeCloseTo(1000, 6);
    expect(hit!.near.x).toBeCloseTo(WGS84_A_M, 6);
    expect(rayEllipsoidIntersection(eye, { x: 1, y: 0, z: 0 })).toBeNull();
    expect(isOccludedByEllipsoid(eye, { x: -WGS84_A_M, y: 0, z: 0 })).toBe(true);
    expect(isOccludedByEllipsoid(eye, { x: WGS84_A_M, y: 0, z: 0 })).toBe(false);
    expect(isOccludedByEllipsoid(eye, { x: WGS84_A_M + 1000, y: 100, z: 0 })).toBe(false);
    expect(isOccludedByEllipsoid({ x: WGS84_A_M, y: 0, z: 0 },
      { x: WGS84_A_M, y: 100, z: 0 })).toBe(false);
    expect(() => rayEllipsoidIntersection(eye, { x: 0, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => rayEllipsoidIntersection(eye, { x: NaN, y: 0, z: 0 })).toThrow(RangeError);
  });
});
