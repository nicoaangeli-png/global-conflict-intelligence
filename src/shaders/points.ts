import { GLOBE, rgb } from "@/lib/config/visual";

/**
 * Nuages de points : continents (planète « faite de données ») et lumières
 * urbaines. Un seul draw call par couche ; la taille à l'écran est constante
 * (uPixelRatio corrige la densité de l'écran), seul l'estompage par
 * orientation donne la profondeur : la face opposée s'éteint progressivement.
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
    vFacing = clamp(dot(N, V), 0.0, 1.0);
    vIntensity = aIntensity;
    vDay = mix(0.30, 1.06, smoothstep(-0.5, 0.32, dot(N, normalize(uLightDir))));

    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * aSize * uPixelRatio;
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
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float shape = smoothstep(1.0, 0.12, d);
    float facing = mix(uFacingFade, 1.0, vFacing);
    vec3 color = mix(uColorFar, uColorNear, vFacing);
    float a = shape * uOpacity * facing * vIntensity * vDay;
    if (a < 0.002) discard;
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
  uBrightness: { value: 1 },
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
  uBrightness: { value: 1.15 },
  uLightDir: {
    value: [GLOBE.body.terminator.x, GLOBE.body.terminator.y, GLOBE.body.terminator.z] as [number, number, number],
  },
};
