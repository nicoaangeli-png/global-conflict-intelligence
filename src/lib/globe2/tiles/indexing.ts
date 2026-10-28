import { normalizeLongitude, splitBBox, toEcef, WGS84_A_M } from "../geo";
import type { EcefMeters, GeoBBox } from "../geo";
import type { CubeFace, GeographicFace, TileBound, TileGeoPoint, TileId, TileSide, TileStrategy } from "./types";

const CUBE_FACES: readonly CubeFace[] = ["px", "nx", "py", "ny", "pz", "nz"];
const GEO_FACES: readonly GeographicFace[] = ["west", "east"];
const RAD = Math.PI / 180;

export function tileKey(id: TileId): string { return `${id.strategy}:${id.face}:${id.z}:${id.x}:${id.y}`; }
export function assertTileId(id: TileId): void {
  if (!Number.isInteger(id.z) || id.z < 0 || id.z > 24 ||
      !Number.isInteger(id.x) || !Number.isInteger(id.y) || id.x < 0 || id.y < 0 ||
      id.x >= 2 ** id.z || id.y >= 2 ** id.z ||
      (id.strategy === "cube" ? !CUBE_FACES.includes(id.face) :
        id.strategy === "geographic" ? !GEO_FACES.includes(id.face) : true)) {
    throw new RangeError("Invalid TileId");
  }
}
export function rootTiles(strategy: TileStrategy): TileId[] {
  return strategy === "cube" ? CUBE_FACES.map(face => ({ strategy, face, z: 0, x: 0, y: 0 })) :
    GEO_FACES.map(face => ({ strategy, face, z: 0, x: 0, y: 0 }));
}
export function parentTile(id: TileId): TileId | null {
  assertTileId(id);
  if (id.z === 0) return null;
  return { ...id, z: id.z - 1, x: Math.floor(id.x / 2), y: Math.floor(id.y / 2) } as TileId;
}
export function childTiles(id: TileId): TileId[] {
  assertTileId(id);
  if (id.z >= 24) throw new RangeError("Maximum TileId depth");
  return [0, 1, 2, 3].map(n => ({ ...id, z: id.z + 1, x: 2 * id.x + (n & 1),
    y: 2 * id.y + (n >> 1) }) as TileId);
}

function faceVector(face: CubeFace, u: number, v: number): EcefMeters {
  switch (face) {
    case "px": return { x: 1, y: u, z: v };
    case "nx": return { x: -1, y: -u, z: v };
    case "py": return { x: -u, y: 1, z: v };
    case "ny": return { x: u, y: -1, z: v };
    case "pz": return { x: u, y: v, z: 1 };
    case "nz": return { x: u, y: -v, z: -1 };
  }
}
function vectorToFace(vector: EcefMeters): { face: CubeFace; u: number; v: number } {
  const { x, y, z } = vector, ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ax >= ay && ax >= az) return x >= 0 ? { face: "px", u: y / x, v: z / x } :
    { face: "nx", u: y / x, v: -z / x };
  if (ay >= ax && ay >= az) return y >= 0 ? { face: "py", u: -x / y, v: z / y } :
    { face: "ny", u: -x / y, v: -z / y };
  return z >= 0 ? { face: "pz", u: x / z, v: y / z } :
    { face: "nz", u: -x / z, v: y / z };
}

/** Geographic roots are two 180° hemispheres; cube roots are six gnomonic faces. */
export function tilePoint(id: TileId, u01: number, v01: number): TileGeoPoint {
  assertTileId(id);
  if (![u01, v01].every(Number.isFinite) || u01 < 0 || u01 > 1 || v01 < 0 || v01 > 1) {
    throw new RangeError("Tile sample must be within [0,1]");
  }
  const n = 2 ** id.z, u = (id.x + u01) / n, v = (id.y + v01) / n;
  if (id.strategy === "geographic") {
    const west = id.face === "west" ? -180 : 0;
    return { latDeg: -90 + 180 * v, lonDeg: normalizeLongitude(west + 180 * u) };
  }
  const vector = faceVector(id.face, 2 * u - 1, 2 * v - 1);
  return { latDeg: Math.atan2(vector.z, Math.hypot(vector.x, vector.y)) / RAD,
    lonDeg: normalizeLongitude(Math.atan2(vector.y, vector.x) / RAD) };
}

/** Deterministic inverse, including the ±180° seam and geographic poles. */
export function tileAt(strategy: TileStrategy, point: TileGeoPoint, z: number): TileId {
  if (!Number.isFinite(point.latDeg) || Math.abs(point.latDeg) > 90 ||
      !Number.isFinite(point.lonDeg) || !Number.isInteger(z) || z < 0 || z > 24) throw new RangeError("Invalid tile lookup");
  const n = 2 ** z, lon = normalizeLongitude(point.lonDeg);
  if (strategy === "geographic") {
    const face: GeographicFace = lon < 0 ? "west" : "east";
    const u = (lon - (face === "west" ? -180 : 0)) / 180;
    const v = (point.latDeg + 90) / 180;
    return { strategy, face, z, x: Math.min(n - 1, Math.floor(u * n)),
      y: Math.min(n - 1, Math.floor(v * n)) };
  }
  const latRad = point.latDeg * RAD, lonRad = lon * RAD;
  const c = Math.cos(latRad);
  const mapped = vectorToFace({ x: c * Math.cos(lonRad), y: c * Math.sin(lonRad), z: Math.sin(latRad) });
  return { strategy, face: mapped.face, z,
    x: Math.min(n - 1, Math.max(0, Math.floor((mapped.u + 1) * 0.5 * n))),
    y: Math.min(n - 1, Math.max(0, Math.floor((mapped.v + 1) * 0.5 * n))) };
}

/** Same-level neighbor, including cube face edges and longitude wrap. Null only at geographic poles. */
export function neighborTile(id: TileId, side: TileSide): TileId | null {
  assertTileId(id);
  const n = 2 ** id.z;
  if (id.strategy === "geographic") {
    if (side === "north" && id.y === n - 1 || side === "south" && id.y === 0) return null;
    if (side === "north" || side === "south") return { ...id, y: id.y + (side === "north" ? 1 : -1) };
    const globalX = (id.face === "west" ? 0 : n) + id.x + (side === "east" ? 1 : -1);
    const wrapped = (globalX + 2 * n) % (2 * n);
    return { strategy: "geographic", face: wrapped < n ? "west" : "east", z: id.z,
      x: wrapped % n, y: id.y };
  }
  const u = (id.x + (side === "east" ? 1 : side === "west" ? 0 : 0.5)) / n * 2 - 1;
  const v = (id.y + (side === "north" ? 1 : side === "south" ? 0 : 0.5)) / n * 2 - 1;
  const epsilon = 1e-7;
  const vector = faceVector(id.face, u + (side === "east" ? epsilon : side === "west" ? -epsilon : 0),
    v + (side === "north" ? epsilon : side === "south" ? -epsilon : 0));
  const mapped = vectorToFace(vector);
  return { strategy: "cube", face: mapped.face, z: id.z,
    x: Math.max(0, Math.min(n - 1, Math.floor((mapped.u + 1) * 0.5 * n))),
    y: Math.max(0, Math.min(n - 1, Math.floor((mapped.v + 1) * 0.5 * n))) };
}

function geographicEnvelope(points: TileGeoPoint[]): readonly GeoBBox[] {
  const lats = points.map(p => p.latDeg), lons = points.map(p => (p.lonDeg + 360) % 360).sort((a, b) => a - b);
  let gap = -1, gapIndex = 0;
  for (let i = 0; i < lons.length; i++) {
    const next = lons[(i + 1) % lons.length] + (i === lons.length - 1 ? 360 : 0);
    if (next - lons[i] > gap) { gap = next - lons[i]; gapIndex = i; }
  }
  const norm = (value: number) => normalizeLongitude(value);
  const west = norm(lons[(gapIndex + 1) % lons.length]), east = norm(lons[gapIndex]);
  return splitBBox({ westDeg: west, eastDeg: east, southDeg: Math.min(...lats), northDeg: Math.max(...lats) });
}

/** Conservative sampled ECEF sphere. Extra angular margin covers curvature between samples. */
export function tileBound(id: TileId): TileBound {
  assertTileId(id);
  const geo: TileGeoPoint[] = [], ecef: EcefMeters[] = [];
  for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) {
    const point = tilePoint(id, x / 4, y / 4);
    geo.push(point);
    ecef.push(toEcef({ ...point, heightM: 0, datum: "WGS84" }));
  }
  const center = { x: 0, y: 0, z: 0 };
  for (const p of ecef) { center.x += p.x / ecef.length; center.y += p.y / ecef.length; center.z += p.z / ecef.length; }
  let radius = 0;
  for (const p of ecef) radius = Math.max(radius, Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z));
  const angularSpanRad = Math.min(Math.PI, (id.strategy === "cube" ? Math.PI / 2 : Math.PI) / 2 ** id.z);
  const sampleMarginM = WGS84_A_M * angularSpanRad / 4;
  const radiusM = radius + sampleMarginM + 1000;
  const geometricErrorM = WGS84_A_M * (1 - Math.cos(angularSpanRad / 2));
  return { center, radiusM, geographic: geographicEnvelope(geo), angularSpanRad, geometricErrorM };
}
