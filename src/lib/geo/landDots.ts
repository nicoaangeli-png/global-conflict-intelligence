import { Vector3 } from "three";
import { GLOBE } from "@/lib/config/visual";
import { latLonToVector3 } from "./latlon";

/**
 * Continents en nuage de points (« planète constituée de données »).
 *
 * La répartition est géométrique (spirale de Fibonacci) : densité uniforme
 * sur la sphère, donc aucun artefact polaire contrairement à une texture
 * équirectangulaire. L'appartenance terre/mer est testée dans un masque
 * binaire 2048×1024 dérivé de Natural Earth 110m (262 Ko, compressible).
 */

const MASK_W = 2048;
const MASK_H = 1024;

export interface LandDots {
  positions: Float32Array;
  sizes: Float32Array;
  count: number;
}

let maskPromise: Promise<Uint8Array> | null = null;

function loadMask(): Promise<Uint8Array> {
  if (!maskPromise) {
    maskPromise = fetch("/data/land_mask.bin")
      .then((r) => {
        if (!r.ok) throw new Error(`masque indisponible (${r.status})`);
        return r.arrayBuffer();
      })
      .then((b) => new Uint8Array(b));
  }
  return maskPromise;
}

function isLand(mask: Uint8Array, lat: number, lon: number): boolean {
  let col = Math.floor(((lon + 180) / 360) * MASK_W) % MASK_W;
  if (col < 0) col += MASK_W;
  const row = Math.floor(((90 - lat) / 180) * MASK_H);
  if (row < 0 || row >= MASK_H) return false;
  const k = row * MASK_W + col;
  return ((mask[k >> 3] >> (k & 7)) & 1) === 1;
}

/** Génère le nuage de points des terres émergées. */
export async function buildLandDots(target = GLOBE.land.dotCount): Promise<LandDots> {
  const mask = await loadMask();
  const positions: number[] = [];
  const sizes: number[] = [];
  const v = new Vector3();
  const golden = Math.PI * (3 - Math.sqrt(5));
  const samples = Math.ceil(target / 0.28);

  for (let i = 0; i < samples && positions.length / 3 < target; i++) {
    const z = 1 - (2 * (i + 0.5)) / samples;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const th = i * golden;
    const x = r * Math.cos(th);
    const y = r * Math.sin(th);
    const lat = Math.asin(Math.max(-1, Math.min(1, z))) * (180 / Math.PI);
    const lon = Math.atan2(y, x) * (180 / Math.PI);
    if (!isLand(mask, lat, lon)) continue;

    latLonToVector3(lat, lon, GLOBE.radius * 1.0006, v);
    positions.push(v.x, v.y, v.z);

    // taille légèrement variable : évite l'aspect « imprimante matricielle »
    const t = Math.random();
    sizes.push(1 - GLOBE.land.dotSizeJitter * 0.5 + t * GLOBE.land.dotSizeJitter);
  }

  return {
    positions: new Float32Array(positions),
    sizes: new Float32Array(sizes),
    count: sizes.length,
  };
}
