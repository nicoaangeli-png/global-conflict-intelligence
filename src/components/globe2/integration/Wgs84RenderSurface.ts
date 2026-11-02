import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import { fromEcef, isOccludedByEllipsoid, normalizeLongitude, toEcef, WGS84_A_M, WGS84_B_M } from "@/lib/globe2/geo";
import { slerpAnchor } from "@/lib/globe2/camera";
import type { RenderSurface } from "@/lib/geo/renderSurface";

const ratio = WGS84_B_M / WGS84_A_M;
const ecef = (p: Vector3) => ({ x: p.x * WGS84_A_M, y: -p.z * WGS84_A_M, z: p.y * WGS84_A_M });

/** Schematic layer offsets in metres, not measurements of a source's unknown altitude. */
export const renderOffsetMeters = (legacyShellRadius: number): number => legacyShellRadius === 1
  ? 0 : 5 + (legacyShellRadius - 1) * 1000;

const point: RenderSurface["point"] = (lat, lon, radius = 1, target = new Vector3()) => {
  const p = toEcef({ latDeg: lat, lonDeg: normalizeLongitude(lon),
    heightM: renderOffsetMeters(radius), datum: "WGS84" });
  return target.set(p.x / WGS84_A_M, p.z / WGS84_A_M, -p.y / WGS84_A_M);
};

/** Keep V1 fragment shaders intact; adapt only coordinates/normals/model transforms. */
export function wgs84VertexShader(source: string): string {
  const normal = "orbitalNormal";
  return `vec3 ${normal}(vec3 p) { return normalize(vec3(p.x, p.y / ${(ratio * ratio).toPrecision(17)}, p.z)); }\n`
    + source
      .replaceAll("normalize(aCenter)", `${normal}(aCenter)`)
      .replaceAll("normalize(position)", `${normal}(position)`)
      .replaceAll("normalize(world.xyz)", `normalize(mat3(modelMatrix) * ${normal}(position))`)
      .replaceAll("cameraPosition - aCenter", "cameraPosition - (modelMatrix * vec4(aCenter, 1.0)).xyz")
      .replaceAll("viewMatrix * vec4(aCenter, 1.0)", "modelViewMatrix * vec4(aCenter, 1.0)")
      // Heading stays a local differential in oblique CITY/DISTRICT views;
      // the legacy fixed tangent step could project behind the near camera.
      .replaceAll("position + dir * 0.02", "position + dir * min(0.02, length(cameraPosition - world.xyz) * 0.01)")
      // Interpolate the vector, normalize in the fragment shader. Interpolating
      // already-normalized directions produces a false full-screen rim near ground.
      .replaceAll("vViewDirW = normalize(cameraPosition - world.xyz)", "vViewDirW = cameraPosition - world.xyz")
      .replaceAll("vWorld = world.xyz", "vWorld = position");
}

export const WGS84_SURFACE: RenderSurface = {
  kind: "wgs84", point, vertexShader: wgs84VertexShader,
  visible: (p, camera) => !isOccludedByEllipsoid(ecef(camera), ecef(p)),
  geometry(radius, width, height, atmosphericShell = false) {
    const positions: number[] = [], normals: number[] = [], uv: number[] = [], indices: number[] = [];
    const p = new Vector3();
    // Ellipsoidal shells retain the artistic radius of the atmosphere/sanctions.
    for (let y = 0; y <= height; y++) for (let x = 0; x <= width; x++) {
      point(90 - y / height * 180, x / width * 360 - 180, atmosphericShell ? 1 : radius, p);
      if (atmosphericShell) p.multiplyScalar(radius);
      positions.push(p.x, p.y, p.z);
      const n = new Vector3(p.x, p.y / (ratio * ratio), p.z).normalize();
      normals.push(n.x, n.y, n.z); uv.push(x / width, 1 - y / height);
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const a = y * (width + 1) + x, b = a + 1, c = a + width + 1, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    geo.setAttribute("uv", new Float32BufferAttribute(uv, 2)); geo.setIndex(indices);
    return geo;
  },
  arc(a, b, radius) {
    const dot = Math.sin(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180)
      + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((b.lon - a.lon) * Math.PI / 180);
    const steps = Math.max(1, Math.ceil(Math.acos(Math.max(-1, Math.min(1, dot))) / (0.1 * Math.PI / 180)));
    return Array.from({ length: steps + 1 }, (_, i) => {
      const geo = slerpAnchor({ latDeg: a.lat, lonDeg: a.lon }, { latDeg: b.lat, lonDeg: b.lon }, i / steps);
      return point(geo.latDeg, geo.lonDeg, radius);
    });
  },
  resurface(p, radius) {
    const geo = fromEcef(ecef(p));
    return point(geo.latDeg, geo.lonDeg, radius, p);
  },
};
