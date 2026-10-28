import type { EcefMeters, GeoPoint, GeoResolution, SourceGeoPoint } from "./types";

// WGS 84 defining parameters (NGA TR8350.2): metres and dimensionless flattening.
export const WGS84_A_M = 6_378_137;
export const WGS84_INV_F = 298.257223563;
export const WGS84_F = 1 / WGS84_INV_F;
export const WGS84_B_M = WGS84_A_M * (1 - WGS84_F);
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export function normalizeLongitude(lonDeg: number): number {
  if (!Number.isFinite(lonDeg)) throw new RangeError("Longitude must be finite");
  const normalized = ((lonDeg % 360) + 540) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function assertGeoPoint(point: GeoPoint): void {
  if (!Number.isFinite(point.latDeg) || point.latDeg < -90 || point.latDeg > 90 ||
      !Number.isFinite(point.lonDeg) || point.lonDeg < -180 || point.lonDeg >= 180 ||
      !Number.isFinite(point.heightM) || point.datum !== "WGS84") {
    throw new RangeError("Expected finite WGS84 latitude, normalized longitude and ellipsoidal height");
  }
}

export function assertEcef(point: EcefMeters): void {
  if (![point.x, point.y, point.z].every(Number.isFinite)) {
    throw new RangeError("ECEF coordinates must be finite");
  }
}

/** Phase 1 only resolves a known ellipsoidal height; geoid/terrain models are absent. */
export function resolveSourcePosition(source: SourceGeoPoint, provenance: string): GeoResolution {
  if (!Number.isFinite(source.latDeg) || source.latDeg < -90 || source.latDeg > 90 ||
      !Number.isFinite(source.lonDeg) || !Number.isFinite(source.heightM ?? 0) ||
      !["WGS84_ELLIPSOID", "MSL", "AGL", "UNKNOWN"].includes(source.verticalDatum)) {
    return { status: "unresolved", reason: "invalid-position" };
  }
  if (source.heightM === null) return { status: "unresolved", reason: "missing-height" };
  if (source.verticalDatum === "UNKNOWN") return { status: "unresolved", reason: "unknown-datum" };
  if (source.verticalDatum !== "WGS84_ELLIPSOID") return { status: "unresolved", reason: "missing-model" };
  if (!provenance.trim()) return { status: "unresolved", reason: "invalid-position" };
  return {
    status: "resolved",
    point: { latDeg: source.latDeg, lonDeg: normalizeLongitude(source.lonDeg), heightM: source.heightM, datum: "WGS84" },
    method: "source-ellipsoid",
    provenance,
  };
}

export function toEcef(point: GeoPoint): EcefMeters {
  assertGeoPoint(point);
  const lat = point.latDeg * RAD;
  const lon = point.lonDeg * RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = WGS84_A_M / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return {
    x: (n + point.heightM) * cosLat * Math.cos(lon),
    y: (n + point.heightM) * cosLat * Math.sin(lon),
    z: (n * (1 - WGS84_E2) + point.heightM) * sinLat,
  };
}

/** Iterative inverse, with explicit polar and centre handling. */
export function fromEcef(ecef: EcefMeters): GeoPoint {
  assertEcef(ecef);
  const p = Math.hypot(ecef.x, ecef.y);
  if (p === 0 && ecef.z === 0) throw new RangeError("Earth centre has no geodetic position");
  if (p < 1e-9) {
    return { latDeg: ecef.z >= 0 ? 90 : -90, lonDeg: 0, heightM: Math.abs(ecef.z) - WGS84_B_M, datum: "WGS84" };
  }
  const lonDeg = normalizeLongitude(Math.atan2(ecef.y, ecef.x) * DEG);
  let lat = Math.atan2(ecef.z, p * (1 - WGS84_E2));
  for (let iteration = 0; iteration < 20; iteration++) {
    const sinLat = Math.sin(lat);
    const n = WGS84_A_M / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    const next = Math.atan2(ecef.z + WGS84_E2 * n * sinLat, p);
    if (Math.abs(next - lat) <= 1e-15) {
      lat = next;
      const sinFinal = Math.sin(lat);
      const cosFinal = Math.cos(lat);
      const radius = WGS84_A_M / Math.sqrt(1 - WGS84_E2 * sinFinal * sinFinal);
      const heightM = Math.abs(cosFinal) >= 0.5
        ? p / cosFinal - radius
        : ecef.z / sinFinal - radius * (1 - WGS84_E2);
      return { latDeg: lat * DEG, lonDeg, heightM, datum: "WGS84" };
    }
    lat = next;
  }
  throw new RangeError("ECEF inverse did not converge");
}
