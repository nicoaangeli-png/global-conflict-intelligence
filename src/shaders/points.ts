import { GLOBE, rgb } from "@/lib/config/visual";

/**
 * Nuages de points : continents (planète « faite de données ») et lumières
 * urbaines. Un seul draw call par couche ; la taille à l'écran est constante
 * (uPixelRatio corrige la densité de l'écran).
 *
 * OCCLUSION STRICTE : Élimination complète de l'hémisphère arrière (dot(N, V) < 0.04)
 * pour éviter toute transparence parasite et garantir une vision nette du globe.
 */

export const pointsVertex = /* glsl */ `
  attribute float aSize;
  attribute float aIntensity;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform vec3  uLightDir;
  varying float vFacing;
  varying float vIntensity;
  varying float vDay;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 N = normalize(mat3(modelMatrix) * normalize(position));
    vec3 V = normalize(cameraPosition - world.xyz);
    float facing = dot(N, V);

    // Occlusion stricte de la face opposée du globe
    if (facing < 0.04) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vFacing = 0.0;
      vIntensity = 0.0;
      vDay = 0.0;
      return;
    }

    // Atténuation douce au limbe
    vFacing = smoothstep(0.04, 0.28, facing);
    vIntensity = aIntensity;
    vDay = mix(0.40, 1.08, smoothstep(-0.4, 0.35, dot(N, normalize(uLightDir))));

    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * aSize * uPixelRatio * mix(0.7, 1.0, vFacing);
  }
`;

export const pointsFragment = /* glsl */ `
  precision highp float;
  uniform vec3  uColorNear;
  uniform vec3  uColorFar;
  uniform float uOpacity;
  uniform float uFacingFade;
  uniform float uBrightness;
  varying float vFacing;
  varying float vIntensity;
  varying float vDay;

  void main() {
    if (vFacing < 0.01) discard;
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float shape = smoothstep(1.0, 0.12, d);
    vec3 color = mix(uColorFar, uColorNear, vFacing);
    float a = shape * uOpacity * vFacing * vIntensity * vDay;
    if (a < 0.01) discard;
    gl_FragColor = vec4(color * uBrightness * vIntensity, a);
  }
`;

export const landDotUniforms = {
  uSize: { value: GLOBE.land.dotSize },
  uPixelRatio: { value: 1 },
  uColorNear: { value: rgb(GLOBE.land.color) },
  uColorFar: { value: rgb(GLOBE.land.colorFar) },
  uOpacity: { value: GLOBE.land.opacity },
  uFacingFade: { value: GLOBE.land.facingFade },
  uBrightness: { value: 1.1 },
  uLightDir: {
    value: [GLOBE.body.terminator.x, GLOBE.body.terminator.y, GLOBE.body.terminator.z] as [number, number, number],
  },
};

export const cityUniforms = {
  uSize: { value: GLOBE.cities.size },
  uPixelRatio: { value: 1 },
  uColorNear: { value: rgb(GLOBE.cities.color) },
  uColorFar: { value: rgb("#2d6f9c") },
  uOpacity: { value: GLOBE.cities.opacity },
  uFacingFade: { value: 0.14 },
  uBrightness: { value: 1.2 },
  uLightDir: {
    value: [GLOBE.body.terminator.x, GLOBE.body.terminator.y, GLOBE.body.terminator.z] as [number, number, number],
  },
};
