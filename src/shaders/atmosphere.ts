import { GLOBE, rgb } from "@/lib/config/visual";

/**
 * Atmosphère en deux coques concentriques :
 *  - coque interne : liseré bleu net sur le limbe (Fresnel serré) ;
 *  - coque externe : halo diffus très large, additif.
 * Aucune géométrie lourde : deux sphères, deux draw calls.
 */

export const atmosphereVertex = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDirW = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const atmosphereFragment = /* glsl */ `
  precision highp float;
  uniform vec3  uColor;
  uniform float uIntensity;
  uniform float uPower;
  uniform float uTime;
  uniform float uPulse;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(vViewDirW);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    // rayonnement maximal sur le limbe
    float rim = pow(1.0 - ndv, uPower);
    float pulse = 1.0 + sin(uTime * 0.22) * uPulse;
    gl_FragColor = vec4(uColor * rim * uIntensity * pulse, rim);
  }
`;

export const atmosphereRimDefaults = {
  uColor: { value: rgb(GLOBE.atmosphere.rimColor) },
  uIntensity: { value: GLOBE.atmosphere.rimIntensity },
  uPower: { value: GLOBE.atmosphere.rimPower },
  uTime: { value: 0 },
  uPulse: { value: 0.05 },
};

export const atmosphereHaloDefaults = {
  uColor: { value: rgb(GLOBE.atmosphere.haloColor) },
  uIntensity: { value: GLOBE.atmosphere.haloIntensity },
  uPower: { value: GLOBE.atmosphere.haloPower },
  uTime: { value: 0 },
  uPulse: { value: 0.08 },
};
