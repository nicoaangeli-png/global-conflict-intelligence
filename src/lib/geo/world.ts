import { Vector3 } from "three";
import { latLonToVector3 } from "./latlon";

/**
 * Index géographique mondial construit à partir de Natural Earth 110m :
 *  - frontières administratives en segments 3D (trait fin),
 *  - test d'appartenance pays ↔ coordonnée (sélection à la souris),
 *  - découpage des frontières par pays (mise en surbrillance).
 */

export interface CountryFeature {
  /** Nom d'usage (Natural Earth `NAME`). */
  name: string;
  iso: string;
  continent: string;
  bbox: [number, number, number, number];
  /** Anneaux [lon, lat][] (extérieur + trous confondus, suffisant pour le picking). */
  rings: number[][][];
  /** Aire approx. (deg²) pour départager les micro-territoires. */
  area: number;
}

export interface WorldIndex {
  countries: CountryFeature[];
  /** Sommets 3D des frontières (2 sommets par segment). */
  borderPositions: Float32Array;
  /** Sommets 3D pour la couche « frontières seules », coloriable par pays. */
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

function* ringsOf(geometry: RawFeature["geometry"]): Generator<number[][]> {
  const coords = geometry.coordinates as never;
  if (geometry.type === "Polygon") {
    for (const ring of coords as number[][][]) yield ring;
  } else if (geometry.type === "MultiPolygon") {
    for (const poly of coords as number[][][][]) for (const ring of poly) yield ring;
  }
}

/** Construit l'index mondial. `radius` place les traits juste au-dessus de la sphère. */
export function buildWorldIndex(
  geojson: { features: RawFeature[] },
  radius = 1.0009,
): WorldIndex {
  const countries: CountryFeature[] = [];
  const byIso = new Map<string, CountryFeature>();

  for (const f of geojson.features) {
    const p = f.properties ?? {};
    const name = pick(p, ["NAME", "ADMIN", "name", "NAME_EN", "SOVEREIGNT"]);
    if (!name) continue;
    const iso = pick(p, ["ISO_A3", "ADM0_A3", "iso_a3", "ISO_A2"]);

    let minLon = 180;
    let maxLon = -180;
    let minLat = 90;
    let maxLat = -90;
    let area = 0;
    const rings: number[][][] = [];

    for (const ring of ringsOf(f.geometry)) {
      if (ring.length < 4) continue;
      rings.push(ring);
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        area += 0; // cumulé ci-dessous
      }
      // aire signée (shoelace) sur le premier anneau
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
      }
    }
    if (!rings.length) continue;

    const country: CountryFeature = {
      name,
      iso,
      continent: pick(p, ["CONTINENT", "continent"]),
      bbox: [minLon, minLat, maxLon, maxLat],
      rings,
      area: Math.abs(area) / 2,
    };
    countries.push(country);
    if (iso) byIso.set(iso, country);
  }

  // Frontières : chaque anneau est converti en segments 3D, avec suivi des
  // plages de sommets par pays (le surlignage réutilise la même source).
  const positions: number[] = [];
  const borderRanges = new Map<string, { start: number; count: number }>();
  const v = new Vector3();
  const seen = new Set<string>();

  for (const country of countries) {
    // Certains pays apparaissent plusieurs fois (territoires séparés) :
    // on fusionne dans une plage unique par nom.
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
      // fusion : on étend la plage uniquement si contiguë
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

function pointInRings(lat: number, lon: number, rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Pays contenant la coordonnée, ou `null` en pleine mer. */
export function countryAt(index: WorldIndex, lat: number, lon: number): CountryFeature | null {
  for (const c of index.countries) {
    const [minLon, minLat, maxLon, maxLat] = c.bbox;
    if (lat < minLat - 0.2 || lat > maxLat + 0.2) continue;
    if (lon < minLon - 0.2 || lon > maxLon + 0.2) continue;
    if (pointInRings(lat, lon, c.rings)) return c;
  }
  return null;
}
