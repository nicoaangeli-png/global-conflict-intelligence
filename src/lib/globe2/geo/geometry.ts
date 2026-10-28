import type { EcefMeters, GeoPoint } from "./types";
import { assertEcef, assertGeoPoint, WGS84_A_M, WGS84_B_M, WGS84_F } from "./wgs84";

export function chordDistanceMeters(a: EcefMeters, b: EcefMeters): number {
  assertEcef(a); assertEcef(b);
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export type GeodesicResult =
  | Readonly<{ status: "converged"; distanceM: number; iterations: number; algorithm: "vincenty-inverse" }>
  | Readonly<{ status: "non-convergent"; iterations: number; algorithm: "vincenty-inverse" }>;

/** WGS84 ellipsoidal surface distance. Height is deliberately ignored. No spherical fallback. */
export function geodesicDistance(a: GeoPoint, b: GeoPoint): GeodesicResult {
  assertGeoPoint(a); assertGeoPoint(b);
  const rad = Math.PI / 180;
  const phi1 = a.latDeg * rad, phi2 = b.latDeg * rad;
  const L = (b.lonDeg - a.lonDeg) * rad;
  const U1 = Math.atan((1 - WGS84_F) * Math.tan(phi1));
  const U2 = Math.atan((1 - WGS84_F) * Math.tan(phi2));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lambda = L;
  for (let iteration = 1; iteration <= 200; iteration++) {
    const sLambda = Math.sin(lambda), cLambda = Math.cos(lambda);
    const sinSigma = Math.hypot(cU2 * sLambda, cU1 * sU2 - sU1 * cU2 * cLambda);
    if (sinSigma === 0) return { status: "converged", distanceM: 0, iterations: iteration, algorithm: "vincenty-inverse" };
    const cosSigma = sU1 * sU2 + cU1 * cU2 * cLambda;
    const sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = cU1 * cU2 * sLambda / sinSigma;
    const cosSqAlpha = 1 - sinAlpha * sinAlpha;
    const cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - 2 * sU1 * sU2 / cosSqAlpha;
    const C = WGS84_F / 16 * cosSqAlpha * (4 + WGS84_F * (4 - 3 * cosSqAlpha));
    const next = L + (1 - C) * WGS84_F * sinAlpha *
      (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(next - lambda) <= 1e-12) {
      const uSq = cosSqAlpha * (WGS84_A_M ** 2 - WGS84_B_M ** 2) / WGS84_B_M ** 2;
      const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
      const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
      const delta = B * sinSigma * (cos2SigmaM + B / 4 *
        (cosSigma * (-1 + 2 * cos2SigmaM ** 2) - B / 6 * cos2SigmaM *
          (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
      return { status: "converged", distanceM: WGS84_B_M * A * (sigma - delta), iterations: iteration, algorithm: "vincenty-inverse" };
    }
    lambda = next;
  }
  return { status: "non-convergent", iterations: 200, algorithm: "vincenty-inverse" };
}
