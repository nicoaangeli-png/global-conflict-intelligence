import type { EcefMeters } from "./types";
import { assertEcef } from "./wgs84";

export type FloatingOrigin = Readonly<{ origin: EcefMeters; originEpoch: number }>;
export type RenderVector = Readonly<{ x: number; y: number; z: number; originEpoch: number }>;

export function createFloatingOrigin(origin: EcefMeters): FloatingOrigin {
  assertEcef(origin);
  return { origin: { ...origin }, originEpoch: 0 };
}

export function rebaseFloatingOrigin(state: FloatingOrigin, origin: EcefMeters): FloatingOrigin {
  assertEcef(origin);
  if (state.origin.x === origin.x && state.origin.y === origin.y && state.origin.z === origin.z) return state;
  if (!Number.isSafeInteger(state.originEpoch) || state.originEpoch < 0 || state.originEpoch === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Invalid origin epoch");
  }
  return { origin: { ...origin }, originEpoch: state.originEpoch + 1 };
}

/** ECEF double subtraction precedes explicit rotation into legacy Three axes. */
export function ecefToRender(point: EcefMeters, state: FloatingOrigin, scale = 1): RenderVector {
  assertEcef(point);
  if (!Number.isFinite(scale) || scale <= 0) throw new RangeError("Scale must be finite and positive");
  return {
    x: (point.x - state.origin.x) * scale,
    y: (point.z - state.origin.z) * scale,
    z: -(point.y - state.origin.y) * scale,
    originEpoch: state.originEpoch,
  };
}

export function renderToEcef(point: RenderVector, state: FloatingOrigin, scale = 1): EcefMeters {
  if (point.originEpoch !== state.originEpoch) throw new RangeError("Stale floating origin epoch");
  if (![point.x, point.y, point.z].every(Number.isFinite) || !Number.isFinite(scale) || scale <= 0) {
    throw new RangeError("Invalid render position or scale");
  }
  return {
    x: point.x / scale + state.origin.x,
    y: -point.z / scale + state.origin.y,
    z: point.y / scale + state.origin.z,
  };
}
