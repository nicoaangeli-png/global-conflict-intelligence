import type { EcefMeters, EnuMeters, GeoPoint, Vec3 } from "./types";
import { assertEcef, assertGeoPoint, toEcef } from "./wgs84";

export type EnuFrame = Readonly<{ origin: EcefMeters; east: Vec3; north: Vec3; up: Vec3 }>;

export function enuFrame(anchor: GeoPoint): EnuFrame {
  assertGeoPoint(anchor);
  const lat = anchor.latDeg * Math.PI / 180;
  const lon = anchor.lonDeg * Math.PI / 180;
  const sLat = Math.sin(lat), cLat = Math.cos(lat), sLon = Math.sin(lon), cLon = Math.cos(lon);
  return {
    origin: toEcef(anchor),
    east: { x: -sLon, y: cLon, z: 0 },
    north: { x: -sLat * cLon, y: -sLat * sLon, z: cLat },
    up: { x: cLat * cLon, y: cLat * sLon, z: sLat },
  };
}

export function ecefToEnu(point: EcefMeters, frame: EnuFrame): EnuMeters {
  assertEcef(point);
  const dx = point.x - frame.origin.x, dy = point.y - frame.origin.y, dz = point.z - frame.origin.z;
  return {
    east: dx * frame.east.x + dy * frame.east.y + dz * frame.east.z,
    north: dx * frame.north.x + dy * frame.north.y + dz * frame.north.z,
    up: dx * frame.up.x + dy * frame.up.y + dz * frame.up.z,
  };
}

export function enuToEcef(position: EnuMeters, frame: EnuFrame): EcefMeters {
  if (![position.east, position.north, position.up].every(Number.isFinite)) {
    throw new RangeError("ENU coordinates must be finite");
  }
  return {
    x: frame.origin.x + position.east * frame.east.x + position.north * frame.north.x + position.up * frame.up.x,
    y: frame.origin.y + position.east * frame.east.y + position.north * frame.north.y + position.up * frame.up.y,
    z: frame.origin.z + position.east * frame.east.z + position.north * frame.north.z + position.up * frame.up.z,
  };
}
