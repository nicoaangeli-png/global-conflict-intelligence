import { Vector3 } from "three";
import { GLOBE } from "@/lib/config/visual";
import { latLonToVector3 } from "./latlon";

/**
 * Lumières urbaines : réseau de points blancs (référence : « Terre connectée »).
 *
 * Source : Natural Earth 110m populated places. Chaque ville est densifiée
 * proportionnellement à sa population, avec une dispersion aléatoire
 * reproductible (PRNG à graine fixe) pour éviter le scintillement entre rendus.
 */

export interface CityLights {
  positions: Float32Array;
  intensities: Float32Array;
  count: number;
}

interface RawPlace {
  properties: Record<string, unknown>;
}

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const num = (p: Record<string, unknown>, keys: string[]): number => {
  for (const k of keys) {
    const v = p[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
};

export function buildCityLights(geojson: { features: RawPlace[] }): CityLights {
  const rand = mulberry32(97531);
  const positions: number[] = [];
  const intensities: number[] = [];
  const v = new Vector3();
  const cfg = GLOBE.cities;

  const places = geojson.features
    .map((f) => {
      const c = (f as unknown as { geometry?: { coordinates?: number[] } }).geometry?.coordinates;
      const pop = num(f.properties, ["POP_MAX", "pop_max", "POP_MIN", "pop_min"]);
      return { lon: c?.[0] ?? NaN, lat: c?.[1] ?? NaN, pop };
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.pop >= cfg.minPopulation)
    .sort((a, b) => b.pop - a.pop);

  for (const place of places) {
    const scale = Math.min(cfg.maxPerCity, Math.max(1, Math.round(Math.sqrt(place.pop / 1e6) * cfg.maxPerCity)));
    // dispersion en degrés, plus large pour les très grandes agglomérations
    const spread = 0.08 + Math.sqrt(place.pop / 1e7) * 0.9;

    for (let i = 0; i < scale; i++) {
      const lat = place.lat + (i === 0 ? 0 : (rand() - 0.5) * spread * 2);
      const lon = place.lon + (i === 0 ? 0 : (rand() - 0.5) * spread * 2.4);
      latLonToVector3(lat, lon, GLOBE.radius * 1.0012, v);
      positions.push(v.x, v.y, v.z);
      // intensité : décroît avec l'éloignement du centre-ville + bruit léger
      const falloff = i === 0 ? 1 : 1 - Math.min(0.85, Math.hypot(lat - place.lat, lon - place.lon) / spread);
      intensities.push(Math.max(0.08, falloff * (0.55 + rand() * 0.45)));
    }
  }

  return {
    positions: new Float32Array(positions),
    intensities: new Float32Array(intensities),
    count: intensities.length,
  };
}

/** Villes notables pour les repères texte (les plus peuplées). */
export function topPlaces(geojson: { features: RawPlace[] }, limit = 260) {
  return geojson.features
    .map((f) => {
      const c = (f as unknown as { geometry?: { coordinates?: number[] } }).geometry?.coordinates;
      const props = f.properties;
      const name =
        (props["NAME"] as string) || (props["name"] as string) || (props["NAMEPAR"] as string) || "";
      const country = (props["ADM0NAME"] as string) || (props["SOV0NAME"] as string) || "";
      const pop = num(props, ["POP_MAX", "pop_max"]);
      return { name, country, pop, lon: c?.[0] ?? NaN, lat: c?.[1] ?? NaN };
    })
    .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .sort((a, b) => b.pop - a.pop)
    .slice(0, limit);
}
