import { Vector3 } from "three";

/**
 * Conversion géodésique ↔ coordonnées 3D.
 *
 * Convention alignée sur l'UV mapping de `THREE.SphereGeometry`
 * (projection équirectangulaire) :
 *   u = (lon + 180) / 360,  v = (90 - lat) / 180
 * afin que toute texture équirectangulaire (Natural Earth) se superpose
 * exactement aux points calculés.
 */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** Latitude / longitude (degrés) → point sur la sphère. */
export function latLonToVector3(lat: number, lon: number, radius = 1, target = new Vector3()): Vector3 {
  const phi = (lon + 180) * DEG;
  const theta = (90 - lat) * DEG;
  const sinTheta = Math.sin(theta);
  return target.set(
    -radius * Math.cos(phi) * sinTheta,
    radius * Math.cos(theta),
    radius * Math.sin(phi) * sinTheta,
  );
}

export function latLonToCameraAngles(lat: number, lon: number): { theta: number; phi: number } {
  const direction = latLonToVector3(lat, lon);
  return {
    theta: Math.atan2(direction.x, direction.z),
    phi: Math.acos(Math.max(-1, Math.min(1, direction.y))),
  };
}

/** Point sur la sphère → latitude / longitude (degrés). */
export function vector3ToLatLon(v: Vector3): { lat: number; lon: number } {
  const r = v.length() || 1;
  const lat = Math.asin(Math.max(-1, Math.min(1, v.y / r))) * RAD;
  let lon = Math.atan2(v.z, -v.x) * RAD - 180;
  while (lon < -180) lon += 360;
  while (lon > 180) lon -= 360;
  return { lat, lon };
}

/** Distance angulaire approchée (km) sur une sphère de rayon terrestre. */
export function greatCircleKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const p1 = aLat * DEG;
  const p2 = bLat * DEG;
  const dp = (bLat - aLat) * DEG;
  const dl = (bLon - aLon) * DEG;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Regroupement en cellules : clé stable pour un rayon donné (en degrés). */
export function cellKey(lat: number, lon: number, degrees: number): string {
  const dLat = Math.max(degrees, 1e-4);
  const dLon = Math.max(degrees / Math.max(0.15, Math.cos(lat * DEG)), 1e-4);
  return `${Math.floor(lat / dLat)}:${Math.floor(lon / dLon)}`;
}
