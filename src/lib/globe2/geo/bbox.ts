import type { GeoBBox } from "./types";
import { normalizeLongitude } from "./wgs84";

/** Closed latitude bounds and longitude intervals; west > east crosses the antimeridian. */
export function assertBBox(bbox: GeoBBox): void {
  if (![bbox.westDeg, bbox.eastDeg, bbox.southDeg, bbox.northDeg].every(Number.isFinite) ||
      bbox.westDeg < -180 || bbox.westDeg > 180 || bbox.eastDeg < -180 || bbox.eastDeg > 180 ||
      bbox.southDeg < -90 || bbox.northDeg > 90 || bbox.southDeg > bbox.northDeg) {
    throw new RangeError("Invalid geographic bbox");
  }
}

/** Normalize longitude endpoints while preserving +180 as a valid eastern boundary. */
export function normalizeBBox(bbox: GeoBBox): GeoBBox {
  if (![bbox.westDeg, bbox.eastDeg, bbox.southDeg, bbox.northDeg].every(Number.isFinite) ||
      bbox.southDeg < -90 || bbox.northDeg > 90 || bbox.southDeg > bbox.northDeg) {
    throw new RangeError("Invalid geographic bbox");
  }
  const span = bbox.eastDeg - bbox.westDeg;
  if (Math.abs(span) >= 360) return { westDeg: -180, southDeg: bbox.southDeg, eastDeg: 180, northDeg: bbox.northDeg };
  const westDeg = normalizeLongitude(bbox.westDeg);
  const rawEast = normalizeLongitude(bbox.eastDeg);
  const eastDeg = rawEast === -180 && span > 0 ? 180 : rawEast;
  return { westDeg, southDeg: bbox.southDeg, eastDeg, northDeg: bbox.northDeg };
}

export function splitBBox(bbox: GeoBBox): readonly GeoBBox[] {
  assertBBox(bbox);
  if (bbox.westDeg <= bbox.eastDeg) return [bbox];
  return [
    { ...bbox, eastDeg: 180 },
    { ...bbox, westDeg: -180 },
  ];
}

/** Touching boundaries count as intersection, including +180/-180 equivalence. */
export function bboxIntersects(a: GeoBBox, b: GeoBBox): boolean {
  const as = splitBBox(a), bs = splitBBox(b);
  if (a.northDeg < b.southDeg || b.northDeg < a.southDeg) return false;
  // Longitude is undefined at either pole: every meridian meets there.
  if ((a.northDeg === 90 && b.northDeg === 90) ||
      (a.southDeg === -90 && b.southDeg === -90)) return true;
  return as.some(x => bs.some(y =>
    (x.westDeg <= y.eastDeg && y.westDeg <= x.eastDeg) ||
    (x.eastDeg === 180 && y.westDeg === -180) ||
    (y.eastDeg === 180 && x.westDeg === -180),
  ));
}

export function bboxContains(bbox: GeoBBox, latDeg: number, lonDeg: number): boolean {
  assertBBox(bbox);
  if (!Number.isFinite(latDeg) || latDeg < -90 || latDeg > 90 || !Number.isFinite(lonDeg)) {
    throw new RangeError("Invalid geographic point");
  }
  if (latDeg < bbox.southDeg || latDeg > bbox.northDeg) return false;
  if (latDeg === 90 || latDeg === -90) return true;
  const lon = normalizeLongitude(lonDeg);
  return splitBBox(bbox).some(part => lon >= part.westDeg && lon <= part.eastDeg ||
    lon === -180 && part.eastDeg === 180);
}
