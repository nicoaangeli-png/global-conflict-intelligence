import { Vector3 } from "three";
import { latLonToVector3 } from "./latlon";
import { canonicalCountryIdentity } from "./country";

/**
 * Index géographique mondial construit à partir de Natural Earth 110m :
 *  - frontières administratives en segments 3D (trait fin),
 *  - test d'appartenance pays ↔ coordonnée précis par polygone & anneaux (outer + holes),
 *  - tri par surface croissante pour éviter les faux positifs des grandes enveloppes,
 *  - découpage des frontières par pays.
 */

export interface CountryFeature {
  name: string;
  iso: string;
  continent: string;
  bbox: [number, number, number, number];
  /** Polygones disjoints : [ [outerRing, hole1, ...], ... ] */
  polygons: number[][][][];
  /** Tous les anneaux pour génération géométrie des frontières */
  rings: number[][][];
  /** Aire approx. (deg²) pour ordonner la recherche (petits territoires en premier) */
  area: number;
}

export interface WorldIndex {
  countries: CountryFeature[];
  borderPositions: Float32Array;
  borderRanges: Map<string, { start: number; count: number }>;
  byIso: Map<string, CountryFeature>;
}

interface RawFeature {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}

const pick = (p: Record<string, unknown>, keys: string[]): string => {
  for (const k of keys) {
    const v = p[k];
    if (typeof v === "string" && v.length) return v;
  }
  return "";
};

/** Teste si un point (lon, lat) est à l'intérieur d'un anneau fermé (algorithme de lancer de rayon). */
function pointInSingleRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Teste si un point est à l'intérieur d'un polygone (dans l'anneau externe et hors des trous). */
function pointInPolygonGeometry(lon: number, lat: number, polygon: number[][][]): boolean {
  if (!polygon.length || !pointInSingleRing(lon, lat, polygon[0])) return false;
  for (let h = 1; h < polygon.length; h++) {
    if (pointInSingleRing(lon, lat, polygon[h])) return false;
  }
  return true;
}

function ringAreaAndCentroid(ring: number[][]): { area: number; lon: number; lat: number } {
  let twiceArea = 0;
  let lonSum = 0;
  let latSum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j];
    const [x2, y2] = ring[i];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    lonSum += (x1 + x2) * cross;
    latSum += (y1 + y2) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) return { area: 0, lon: 0, lat: 0 };
  return { area: Math.abs(twiceArea / 2), lon: lonSum / (3 * twiceArea), lat: latSum / (3 * twiceArea) };
}

/** Interior point for focusing a country, including concave shapes and archipelagos. */
export function countryInteriorPoint(geometry: { type?: string; coordinates?: unknown } | null | undefined): { lat: number; lon: number } | null {
  const polygons = (geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : []) as number[][][][];
  let bestPolygon: number[][][] | null = null;
  let bestArea = -1;
  for (const polygon of polygons ?? []) {
    const ring = polygon?.[0];
    if (!ring || ring.length < 4) continue;
    const area = ringAreaAndCentroid(ring).area;
    if (area > bestArea) { bestArea = area; bestPolygon = polygon; }
  }
  if (!bestPolygon) return null;
  const outer = bestPolygon[0];
  const centroid = ringAreaAndCentroid(outer);
  if (pointInPolygonGeometry(centroid.lon, centroid.lat, bestPolygon)) return { lat: centroid.lat, lon: centroid.lon };

  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of outer) { minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); }
  let point: { lat: number; lon: number } | null = null;
  let bestClearance = -1;
  const segments = bestPolygon.flatMap((ring) => ring.slice(1).map((b, i) => [ring[i], b] as const));
  const steps = 64;
  for (let y = 0; y <= steps; y++) for (let x = 0; x <= steps; x++) {
    const lon = minLon + (maxLon - minLon) * x / steps;
    const lat = minLat + (maxLat - minLat) * y / steps;
    if (!pointInPolygonGeometry(lon, lat, bestPolygon)) continue;
    let clearance = Infinity;
    for (const [[x1, y1], [x2, y2]] of segments) {
      const dx = x2 - x1, dy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((lon - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy || 1)));
      clearance = Math.min(clearance, (lon - x1 - t * dx) ** 2 + (lat - y1 - t * dy) ** 2);
    }
    if (clearance > bestClearance) { bestClearance = clearance; point = { lat, lon }; }
  }
  return point ?? (pointInPolygonGeometry(outer[0][0], outer[0][1], bestPolygon) ? { lat: outer[0][1], lon: outer[0][0] } : null);
}

/** Construit l'index mondial avec géométries polygonales isolées et tri d'emprise. */
export function buildWorldIndex(
  geojson: { features: RawFeature[] },
  radius = 1.0009,
): WorldIndex {
  const countries: CountryFeature[] = [];
  const byIso = new Map<string, CountryFeature>();

  for (const f of geojson.features) {
    const p = f.properties ?? {};
    const sourceName = pick(p, ["ADMIN", "NAME", "name", "NAME_EN", "SOVEREIGNT"]);
    if (!sourceName) continue;
    const identity = canonicalCountryIdentity(sourceName, {
      isoA3: p.ISO_A3 ?? p.iso_a3,
      adm0A3: p.ADM0_A3,
      sovA3: p.SOV_A3,
    });
    const name = identity?.name ?? sourceName;
    const iso = identity?.iso3 ?? "";

    let polygons: number[][][][] = [];
    if (f.geometry.type === "Polygon") {
      polygons = [f.geometry.coordinates as number[][][]];
    } else if (f.geometry.type === "MultiPolygon") {
      polygons = f.geometry.coordinates as number[][][][];
    }

    let minLon = 180;
    let maxLon = -180;
    let minLat = 90;
    let maxLat = -90;
    const rings: number[][][] = [];

    for (const poly of polygons) {
      for (const ring of poly) {
        if (ring.length < 4) continue;
        rings.push(ring);
        for (const [lon, lat] of ring) {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
    if (!rings.length) continue;

    const area = (maxLon - minLon) * (maxLat - minLat);

    const country: CountryFeature = {
      name,
      iso,
      continent: pick(p, ["CONTINENT", "continent"]),
      bbox: [minLon, minLat, maxLon, maxLat],
      polygons,
      rings,
      area,
    };
    countries.push(country);
    if (iso) byIso.set(iso, country);
  }

  // Tri par surface croissante : les petits pays sont testés en priorité,
  // ce qui évite les faux positifs dus aux grandes enveloppes (Russie, Canada, Chine).
  countries.sort((a, b) => a.area - b.area);

  // Frontières : chaque anneau est converti en segments 3D
  const positions: number[] = [];
  const borderRanges = new Map<string, { start: number; count: number }>();
  const v = new Vector3();
  const seen = new Set<string>();

  for (const country of countries) {
    const key = country.iso || country.name;
    const start = positions.length / 3;
    for (const ring of country.rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const b = ring[i + 1];
        // évite l'artefact de couture ±180°
        if (Math.abs(a[0] - b[0]) > 180) continue;
        latLonToVector3(a[1], a[0], radius, v);
        positions.push(v.x, v.y, v.z);
        latLonToVector3(b[1], b[0], radius, v);
        positions.push(v.x, v.y, v.z);
      }
    }
    const count = positions.length / 3 - start;
    const prev = seen.has(key) ? borderRanges.get(key) : undefined;
    if (prev) {
      if (prev.start + prev.count === start) prev.count += count;
      else borderRanges.set(`${key}#${borderRanges.size}`, { start, count });
    } else {
      borderRanges.set(key, { start, count });
    }
    seen.add(key);
  }

  return {
    countries,
    borderPositions: new Float32Array(positions),
    borderRanges,
    byIso,
  };
}

/**
 * Détermine le pays exact contenant la coordonnée (lat, lon).
 * Retourne `null` en pleine mer.
 */
export function countryAt(index: WorldIndex, lat: number, lon: number): CountryFeature | null {
  for (const c of index.countries) {
    const [minLon, minLat, maxLon, maxLat] = c.bbox;
    // Bbox fast-reject
    if (lat < minLat - 0.1 || lat > maxLat + 0.1) continue;
    if (lon < minLon - 0.1 || lon > maxLon + 0.1) continue;

    // Test précis de chaque polygone disjoint
    for (const poly of c.polygons) {
      if (pointInPolygonGeometry(lon, lat, poly)) return c;
    }
  }
  return null;
}
