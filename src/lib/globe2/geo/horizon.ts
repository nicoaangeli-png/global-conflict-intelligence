import type { EcefMeters, Vec3 } from "./types";
import { assertEcef, WGS84_A_M, WGS84_B_M } from "./wgs84";

export type RayEllipsoidHit = Readonly<{ nearT: number; farT: number; near: EcefMeters; far: EcefMeters }>;

/** Ray parameter t is in the caller's direction units; a hit requires farT >= 0. */
export function rayEllipsoidIntersection(origin: EcefMeters, direction: Vec3): RayEllipsoidHit | null {
  assertEcef(origin);
  if (![direction.x, direction.y, direction.z].every(Number.isFinite) ||
      Math.hypot(direction.x, direction.y, direction.z) === 0) {
    throw new RangeError("Ray direction must be finite and non-zero");
  }
  // Scale to unit ellipsoid to avoid squaring six-million-metre coordinates.
  const ox = origin.x / WGS84_A_M, oy = origin.y / WGS84_A_M, oz = origin.z / WGS84_B_M;
  const dx = direction.x / WGS84_A_M, dy = direction.y / WGS84_A_M, dz = direction.z / WGS84_B_M;
  const a = dx * dx + dy * dy + dz * dz;
  const halfB = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - 1;
  const discriminant = halfB * halfB - a * c;
  // A near-tangent miss stays a miss. False occlusion would be harmful to culling.
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const q = -halfB - Math.sign(halfB || 1) * root;
  const t1 = q === 0 ? -halfB / a : q / a;
  const t2 = q === 0 ? t1 : c / q;
  const nearT = Math.min(t1, t2), farT = Math.max(t1, t2);
  if (farT < 0) return null;
  const at = (t: number): EcefMeters => ({
    x: origin.x + t * direction.x,
    y: origin.y + t * direction.y,
    z: origin.z + t * direction.z,
  });
  return { nearT, farT, near: at(nearT), far: at(farT) };
}

/** True only if the reference ellipsoid blocks the open segment. Terrain heights are unknown. */
export function isOccludedByEllipsoid(observer: EcefMeters, target: EcefMeters): boolean {
  assertEcef(observer); assertEcef(target);
  const direction = { x: target.x - observer.x, y: target.y - observer.y, z: target.z - observer.z };
  if (direction.x === 0 && direction.y === 0 && direction.z === 0) return false;
  const hit = rayEllipsoidIntersection(observer, direction);
  // A single tangent contact (including the observer's own surface point)
  // is not an occluding volume. Prefer retaining uncertain objects.
  return hit !== null && hit.nearT < 1 - 1e-10 &&
    hit.farT - Math.max(hit.nearT, 0) > 1e-10;
}
