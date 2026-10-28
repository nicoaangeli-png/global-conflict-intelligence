import type { EcefMeters, GeoBBox, GeoPoint, Vec3 } from "../geo";
import { fromEcef, rayEllipsoidIntersection, splitBBox, WGS84_A_M } from "../geo";
import type { CameraPose, ViewFootprint } from "./types";
import { add, clamp, dot, mul, unit } from "./math";

const FULL_WORLD: GeoBBox = { westDeg: -180, eastDeg: 180, southDeg: -90, northDeg: 90 };

export function rayAtNdc(pose: CameraPose, ndcX: number, ndcY: number): Vec3 {
  if (![ndcX, ndcY].every(Number.isFinite)) throw new RangeError("Invalid screen coordinate");
  const tan = Math.tan(pose.verticalFovRad / 2);
  const aspect = pose.viewportCss.width / pose.viewportCss.height;
  return unit(add(add(pose.forwardEcef, mul(pose.rightEcef, ndcX * tan * aspect)),
    mul(pose.upEcef, ndcY * tan)));
}

export function groundAtNdc(pose: CameraPose, ndcX: number, ndcY: number): GeoPoint | null {
  const direction = rayAtNdc(pose, ndcX, ndcY);
  const hit = rayEllipsoidIntersection(pose.eyeEcef, direction);
  if (!hit) return null;
  const t = hit.nearT >= 0 ? hit.nearT : hit.farT;
  if (t < 0) return null;
  const ecef: EcefMeters = {
    x: pose.eyeEcef.x + direction.x * t,
    y: pose.eyeEcef.y + direction.y * t,
    z: pose.eyeEcef.z + direction.z * t,
  };
  const point = fromEcef(ecef);
  return { ...point, heightM: 0 }; // Ellipsoid hit, not terrain elevation.
}

function boundsFor(points: readonly GeoPoint[]): readonly GeoBBox[] {
  if (points.length === 0) return [];
  const lons = points.map(p => (p.lonDeg + 360) % 360).sort((a, b) => a - b);
  let largestGap = -1, gapIndex = 0;
  for (let i = 0; i < lons.length; i++) {
    const gap = (lons[(i + 1) % lons.length] + (i === lons.length - 1 ? 360 : 0)) - lons[i];
    if (gap > largestGap) { largestGap = gap; gapIndex = i; }
  }
  const west = lons[(gapIndex + 1) % lons.length];
  const east = lons[gapIndex];
  const normalize = (lon: number) => lon >= 180 ? lon - 360 : lon;
  return splitBBox({
    westDeg: normalize(west), eastDeg: normalize(east),
    southDeg: Math.min(...points.map(p => p.latDeg)),
    northDeg: Math.max(...points.map(p => p.latDeg)),
  });
}

/** Conservative Phase 2 footprint: partial views return a world-covering bbox, not false precision. */
export function computeViewFootprint(pose: CameraPose): ViewFootprint {
  const samples: GeoPoint[] = [];
  const coords = [-1, 0, 1];
  for (const y of coords) for (const x of coords) {
    const hit = groundAtNdc(pose, x, y);
    if (hit) samples.push(hit);
  }
  const center = groundAtNdc(pose, 0, 0);
  const partial = samples.length < 9;
  let groundSpanM: number | null = null;
  if (samples.length >= 2 && !partial) {
    let largestChordM = 0;
    for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) {
      // Chord length is stable even across the antimeridian.
      const a = toUnit(samples[i]), b = toUnit(samples[j]);
      const angle = Math.acos(clamp(dot(a, b), -1, 1));
      largestChordM = Math.max(largestChordM, angle * WGS84_A_M);
    }
    groundSpanM = largestChordM;
  } else if (center) {
    // Geodetic height avoids a false zero at latitudes where ellipsoid radius < a.
    const eyeHeightM = Math.max(0, fromEcef(pose.eyeEcef).heightM);
    groundSpanM = 2 * WGS84_A_M * Math.acos(clamp(WGS84_A_M / (WGS84_A_M + eyeHeightM), -1, 1));
  }
  const spans = partial ? [FULL_WORLD] : boundsFor(samples);
  return { center, spans, crossesAntimeridian: boundsFor(samples).length > 1,
    groundSpanM, horizonVisible: partial, partial, revision: pose.revision };
}

function toUnit(p: GeoPoint): Vec3 {
  const lat = p.latDeg * Math.PI / 180, lon = p.lonDeg * Math.PI / 180;
  return { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) };
}
