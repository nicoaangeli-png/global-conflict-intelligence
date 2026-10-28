import type { EcefMeters, GeoPoint, Vec3 } from "../geo";
import { enuFrame, normalizeLongitude, WGS84_A_M } from "../geo";
import type { MapAnchor } from "./types";

export const MIN_DISTANCE_M = 120;
export const MAX_DISTANCE_M = 80_000_000;
export const MIN_CLEARANCE_M = 80;
export const MAX_TILT_RAD = 78 * Math.PI / 180;
export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const finite = (...values: number[]) => values.every(Number.isFinite);
export const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const length = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
export const unit = (v: Vec3): Vec3 => {
  const n = length(v);
  if (!Number.isFinite(n) || n === 0) throw new RangeError("Zero or invalid direction");
  return mul(v, 1 / n);
};
export const anchor = (latDeg: number, lonDeg: number): GeoPoint => ({ latDeg, lonDeg: normalizeLongitude(lonDeg), heightM: 0, datum: "WGS84" });
export const validateAnchor = (p: MapAnchor): void => {
  if (!finite(p.latDeg, p.lonDeg) || Math.abs(p.latDeg) > 90) throw new RangeError("Invalid map anchor");
};
const normalFor = (p: MapAnchor): Vec3 => {
  const lat = p.latDeg * RAD, lon = p.lonDeg * RAD;
  return { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) };
};

/** Unit-sphere great-circle interpolation; explicitly resolves antipodal ambiguity. */
export function slerpAnchor(a: MapAnchor, b: MapAnchor, t: number): GeoPoint {
  validateAnchor(a); validateAnchor(b);
  if (!Number.isFinite(t) || t < 0 || t > 1) throw new RangeError("Invalid interpolation fraction");
  if (t === 0) return anchor(a.latDeg, a.lonDeg);
  if (t === 1) return anchor(b.latDeg, b.lonDeg);
  const av = normalFor(a);
  const bv = normalFor(b);
  const cosine = clamp(dot(av, bv), -1, 1);
  if (cosine > 1 - 1e-12) return anchor(a.latDeg + (b.latDeg - a.latDeg) * t,
    a.lonDeg + normalizeLongitude(b.lonDeg - a.lonDeg) * t);
  // Deterministic orthogonal plane at antipodes. Vincenty is not involved.
  const tangent = cosine < -1 + 1e-12
    ? unit(cross(av, Math.abs(av.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 }))
    : unit(sub(bv, mul(av, cosine)));
  const angle = Math.acos(cosine) * t;
  const v = add(mul(av, Math.cos(angle)), mul(tangent, Math.sin(angle)));
  return anchor(Math.atan2(v.z, Math.hypot(v.x, v.y)) * DEG, Math.atan2(v.y, v.x) * DEG);
}

/** Move a surface anchor by tangent metres and renormalize onto the ellipsoid. */
export function moveAnchor(p: MapAnchor, eastM: number, northM: number): GeoPoint {
  validateAnchor(p);
  if (!finite(eastM, northM)) throw new RangeError("Invalid pan");
  const frame = enuFrame(anchor(p.latDeg, p.lonDeg));
  const initial = normalFor(p);
  const delta = add(mul(frame.east, eastM / WGS84_A_M), mul(frame.north, northM / WGS84_A_M));
  const v = unit(add(initial, delta));
  return anchor(Math.atan2(v.z, Math.hypot(v.x, v.y)) * DEG, Math.atan2(v.y, v.x) * DEG);
}

export function shortestAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function poseFor(target: GeoPoint, distanceM: number, headingRad: number, pitchRad: number): {
  eyeEcef: EcefMeters; targetEcef: EcefMeters; upEcef: Vec3; forwardEcef: Vec3; rightEcef: Vec3;
} {
  const frame = enuFrame(target);
  const north = add(mul(frame.north, Math.cos(headingRad)), mul(frame.east, Math.sin(headingRad)));
  // Eye is south of the target at heading=0, so geographic north remains screen-up.
  const offset = add(mul(frame.up, Math.cos(pitchRad) * distanceM), mul(north, -Math.sin(pitchRad) * distanceM));
  const eyeEcef = add(frame.origin, offset);
  const forwardEcef = unit(sub(frame.origin, eyeEcef));
  const upEcef = unit(add(mul(north, Math.cos(pitchRad)), mul(frame.up, Math.sin(pitchRad))));
  const rightEcef = unit(cross(forwardEcef, upEcef));
  return { eyeEcef, targetEcef: frame.origin, upEcef, forwardEcef, rightEcef };
}
