/** Source coordinates retain the vertical datum and missing height exactly as received. */
export type SourceGeoPoint = Readonly<{
  latDeg: number;
  lonDeg: number;
  heightM: number | null;
  verticalDatum: "WGS84_ELLIPSOID" | "MSL" | "AGL" | "UNKNOWN";
}>;

/** Canonical geodetic position: resolved WGS84 ellipsoidal height in metres. */
export type GeoPoint = Readonly<{
  latDeg: number;
  lonDeg: number;
  heightM: number;
  datum: "WGS84";
}>;

export type GeoResolution =
  | Readonly<{ status: "resolved"; point: GeoPoint; method: "source-ellipsoid"; provenance: string }>
  | Readonly<{ status: "unresolved"; reason: "missing-height" | "unknown-datum" | "missing-model" | "invalid-position" }>;

export type EcefMeters = Readonly<{ x: number; y: number; z: number }>;
export type EnuMeters = Readonly<{ east: number; north: number; up: number }>;
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;

export type GeoBBox = Readonly<{
  westDeg: number;
  southDeg: number;
  eastDeg: number;
  northDeg: number;
}>;
