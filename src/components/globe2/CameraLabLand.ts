import type * as ThreeTypes from "three";
import { toEcef } from "@/lib/globe2/geo";

type Ring = number[][];
type Polygon = Ring[];
type CountryFeature = {
  type: "Feature";
  properties?: { ADMIN?: string };
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: Polygon | Polygon[] };
};
type CountryCollection = { type: "FeatureCollection"; features: CountryFeature[] };

const textureWidth = 2048;
const textureHeight = 1024;

/** The lab ellipsoid is built in WGS84 ECEF, then rotated into Three's Y-up frame. */
export function createLabEllipsoid(THREE: typeof ThreeTypes): ThreeTypes.BufferGeometry {
  const lonSteps = 192, latSteps = 96;
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let y = 0; y <= latSteps; y++) {
    const lat = -90 + y * 180 / latSteps;
    for (let x = 0; x <= lonSteps; x++) {
      const lon = -180 + x * 360 / lonSteps;
      const ecef = toEcef({ latDeg: lat, lonDeg: lon === 180 ? -180 : lon, heightM: 0, datum: "WGS84" });
      positions.push(ecef.x, ecef.z, -ecef.y);
      const normal = new THREE.Vector3(ecef.x, ecef.z, -ecef.y).normalize();
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(x / lonSteps, y / latSteps);
    }
  }
  for (let y = 0; y < latSteps; y++) for (let x = 0; x < lonSteps; x++) {
    const a = y * (lonSteps + 1) + x, b = a + 1, c = a + lonSteps + 1, d = c + 1;
    indices.push(a, b, d, a, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function polygons(feature: CountryFeature): Polygon[] {
  return feature.geometry.type === "Polygon"
    ? [feature.geometry.coordinates as Polygon]
    : feature.geometry.coordinates as Polygon[];
}

/** Unwrap each ring so Fiji and other antimeridian polygons never cross the whole map. */
function unwrap(ring: Ring): Ring {
  const result: Ring = [];
  for (const coordinate of ring) {
    const [rawLon, lat] = coordinate;
    if (!Number.isFinite(rawLon) || !Number.isFinite(lat) || Math.abs(lat) > 90) continue;
    let lon = rawLon;
    if (result.length) {
      const previous = result[result.length - 1][0];
      while (lon - previous > 180) lon -= 360;
      while (lon - previous < -180) lon += 360;
    }
    result.push([lon, lat]);
  }
  return result;
}

function drawPolygon(ctx: CanvasRenderingContext2D, polygon: Polygon): void {
  for (const shift of [-360, 0, 360]) {
    ctx.beginPath();
    for (const rawRing of polygon) {
      const ring = unwrap(rawRing);
      ring.forEach(([lon, lat], index) => {
        const x = (lon + shift + 180) / 360 * textureWidth;
        const y = (90 - lat) / 180 * textureHeight;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fill("evenodd");
  }
}

function addBorderSegments(ring: Ring, output: number[]): number {
  const points = unwrap(ring);
  let count = 0;
  for (let i = 1; i < points.length; i++) {
    const [lonA, latA] = points[i - 1], [lonB, latB] = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(lonB - lonA, latB - latA) / 1.5));
    for (let step = 0; step < steps; step++) {
      for (const fraction of [step / steps, (step + 1) / steps]) {
        let lon = lonA + (lonB - lonA) * fraction;
        lon = ((lon + 180) % 360 + 360) % 360 - 180;
        const ecef = toEcef({ latDeg: latA + (latB - latA) * fraction,
          lonDeg: lon, heightM: 1200, datum: "WGS84" });
        output.push(ecef.x, ecef.z, -ecef.y);
      }
      count++;
    }
  }
  return count;
}

export type LabLand = {
  texture: ThreeTypes.CanvasTexture;
  borders: ThreeTypes.LineSegments;
  franceBorder: ThreeTypes.LineSegments;
  countryCount: number;
  borderSegments: number;
  dispose(): void;
};

/** Natural Earth supplies the geography; all 3D positions use Geo Core WGS84/ECEF. */
export function createLabLand(THREE: typeof ThreeTypes, input: unknown, darkSurface = false): LabLand {
  if (!input || typeof input !== "object" || (input as CountryCollection).type !== "FeatureCollection"
    || !Array.isArray((input as CountryCollection).features)) throw new Error("Natural Earth GeoJSON invalide");
  const countries = (input as CountryCollection).features;
  const canvas = document.createElement("canvas");
  canvas.width = textureWidth; canvas.height = textureHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponible pour Natural Earth");
  ctx.fillStyle = darkSurface ? "#03111c" : "#061723";
  ctx.fillRect(0, 0, textureWidth, textureHeight);
  const borders: number[] = [], franceBorders: number[] = [];
  let countryCount = 0, borderSegments = 0;
  for (const country of countries) {
    if (country?.type !== "Feature" || !country.geometry ||
      !["Polygon", "MultiPolygon"].includes(country.geometry.type)) continue;
    const isFrance = country.properties?.ADMIN === "France";
    ctx.fillStyle = darkSurface ? (isFrance ? "#0d2b38" : "#08202c") : (isFrance ? "#246078" : "#123e50");
    for (const polygon of polygons(country)) {
      drawPolygon(ctx, polygon);
      for (const ring of polygon) borderSegments += addBorderSegments(ring, isFrance ? franceBorders : borders);
    }
    countryCount++;
  }
  if (countryCount < 100 || franceBorders.length === 0) throw new Error("Natural Earth incomplet : pays ou France absents");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const makeLines = (positions: number[], color: number, opacity: number) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  };
  const borderMesh = makeLines(borders, 0x4d9bb3, 0.55);
  const franceBorder = makeLines(franceBorders, 0xa1e8f2, 0.9);
  return { texture, borders: borderMesh, franceBorder, countryCount, borderSegments,
    dispose() { texture.dispose(); borderMesh.geometry.dispose(); (borderMesh.material as ThreeTypes.Material).dispose();
      franceBorder.geometry.dispose(); (franceBorder.material as ThreeTypes.Material).dispose(); } };
}
