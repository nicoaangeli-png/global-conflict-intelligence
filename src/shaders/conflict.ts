import { CONFLICT, PALETTE, rgb } from "@/lib/config/visual";

/**
 * Marqueurs de conflit.
 *
 * Une seule géométrie (4 sommets par foyer) → un seul draw call pour
 * l'ensemble des foyers. Chaque quad est un panneau face caméra dans lequel
 * le fragment shader dessine : noyau incandescent, halo, deux anneaux
 * concentriques en expansion. L'intensité agit sur la luminosité, la couleur,
 * la taille du halo et la vitesse de pulsation — jamais sur la seule taille.
 */
export const conflictVertex = /* glsl */ `
  attribute vec3  aCenter;
  attribute vec2  aCorner;
  attribute vec4  aParams;   // x = intensité, y = phase, z = sélection, w = graine
  attribute float aReal;     // 1 = source réelle, 0 = démonstration

  uniform float uTime;
  uniform float uSize;        // taille halo min (px)
  uniform float uSizeMax;     // taille halo max (px)
  uniform float uPixelScale;  // 2*tan(fov/2)/hauteur
  uniform float uReveal;      // 0 → 1 apparition progressive

  varying vec2  vCorner;
  varying vec4  vParams;
  varying float vFacing;
  varying float vReveal;
  varying float vReal;

  void main() {
    vec3 N = normalize(aCenter);
    vec3 V = normalize(cameraPosition - aCenter);
    vFacing = clamp(dot(N, V), 0.0, 1.0);
    vReal = clamp(aReal, 0.0, 1.0);

    float delay = fract(aParams.y * 0.37) * 0.55;
    float reveal = clamp((uReveal - delay) / 0.45, 0.0, 1.0);
    reveal = reveal * reveal * (3.0 - 2.0 * reveal);

    float size = mix(uSize, uSizeMax, aParams.x) * mix(0.55, 1.0, reveal);

    vec4 mv = viewMatrix * vec4(aCenter, 1.0);
    mv.xy += aCorner * size * uPixelScale * (-mv.z);
    gl_Position = projectionMatrix * mv;

    vCorner = aCorner;
    vParams = aParams;
    vReveal = reveal;
  }
`;

export const conflictFragment = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec3  uColorLow;
  uniform vec3  uColorHigh;
  uniform vec3  uColorCore;
  uniform vec3  uColorLowDemo;
  uniform vec3  uColorHighDemo;
  uniform vec3  uColorCoreDemo;
  uniform float uHaloOpacity;
  uniform float uCoreRatioMin;
  uniform float uCoreRatioMax;
  uniform float uRingWidth;
  uniform float uRingSpeed;
  uniform float uPulsePeriod;
  uniform float uPulseAmplitude;
  uniform float uFacingFade;

  varying vec2  vCorner;
  varying vec4  vParams;
  varying float vFacing;
  varying float vReveal;
  varying float vReal;

  void main() {
    float intensity = clamp(vParams.x, 0.0, 1.0);
    float phase = vParams.y;
    float selected = vParams.z;
    float seed = vParams.w;

    float rr = length(vCorner);
    if (rr > 1.0) discard;

    float coreRatio = mix(uCoreRatioMin, uCoreRatioMax, intensity);

    // Noyau incandescent
    float core = exp(-pow(rr / max(coreRatio, 0.001), 2.0) * 1.35);

    // Halo diffus
    float halo = pow(max(0.0, 1.0 - rr), 2.6);

    // Anneaux concentriques en expansion
    float rings = 0.0;
    for (int i = 0; i < 2; i++) {
      float ph = fract(uTime * uRingSpeed * (0.65 + intensity * 0.9) + phase * 1.7 + float(i) * 0.5);
      float rad = mix(coreRatio * 1.6, 0.96, ph);
      float w = uRingWidth * (0.35 + ph * 1.1);
      rings += smoothstep(w, 0.0, abs(rr - rad)) * pow(1.0 - ph, 1.7);
    }

    // Pulsation lente
    float pulse = 1.0 + sin((uTime / max(uPulsePeriod, 0.1)) * 6.2831853 + seed * 6.0) * uPulseAmplitude;
    float flicker = 0.94 + 0.06 * sin(uTime * 5.3 + seed * 11.0);

    vec3 low   = mix(uColorLowDemo,  uColorLow,  vReal);
    vec3 high  = mix(uColorHighDemo, uColorHigh, vReal);
    vec3 coreC = mix(uColorCoreDemo, uColorCore, vReal);

    vec3 base = mix(low, high, smoothstep(0.05, 0.95, intensity));
    vec3 rgb = coreC * core * (0.80 + intensity * 0.55)
             + base * (halo * uHaloOpacity + rings * 0.95);

    // Survolement : surcroît modéré. Sélection : surcroît net + liseré animé.
    float hover = step(0.35, selected);
    rgb *= 1.0 + hover * 0.35;

    float selRing = 0.0;
    if (selected > 0.85) {
      float ph = fract(uTime * 0.22);
      selRing = smoothstep(0.02, 0.0, abs(rr - mix(0.35, 0.99, ph))) * 0.9;
      rgb *= 1.5;
    }

    float facing = mix(uFacingFade, 1.0, vFacing);
    float alpha = (core + halo * 0.75 + rings * 0.8 + selRing) * facing * pulse * flicker * vReveal;
    alpha = clamp(alpha, 0.0, 1.0);

    if (alpha < 0.003) discard;
    gl_FragColor = vec4(rgb * pulse * flicker, alpha);
  }
`;

export const conflictUniforms = {
  uTime: { value: 0 },
  uSize: { value: CONFLICT.marker.haloSize },
  uSizeMax: { value: CONFLICT.marker.haloSizeMax },
  uPixelScale: { value: 0.001 },
  uReveal: { value: 1 },
  uColorLow: { value: rgb(PALETTE.conflictLow) },
  uColorHigh: { value: rgb(PALETTE.conflictMid) },
  uColorCore: { value: rgb("#ffe3d6") },
  uColorLowDemo: { value: rgb(PALETTE.demoLow) },
  uColorHighDemo: { value: rgb(PALETTE.demoMid) },
  uColorCoreDemo: { value: rgb(PALETTE.demoCore) },
  uHaloOpacity: { value: CONFLICT.marker.haloOpacity },
  uCoreRatioMin: { value: 0.12 },
  uCoreRatioMax: { value: 0.095 },
  uRingWidth: { value: CONFLICT.marker.ringWidth },
  uRingSpeed: { value: CONFLICT.marker.ringSpeed },
  uPulsePeriod: { value: CONFLICT.marker.pulsePeriod },
  uPulseAmplitude: { value: CONFLICT.marker.pulseAmplitude },
  uFacingFade: { value: 0.1 },
};

/** Incrustation surfacique : halo de chaleur posé sur la sphère. */
export const heatVertex = /* glsl */ `
  attribute float aSize;
  attribute float aIntensity;
  attribute float aReal;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uTime;
  varying float vFacing;
  varying float vIntensity;
  varying float vReal;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 N = normalize(mat3(modelMatrix) * normalize(position));
    vec3 V = normalize(cameraPosition - world.xyz);
    vFacing = clamp(dot(N, V), 0.0, 1.0);
    vIntensity = aIntensity;
    vReal = clamp(aReal, 0.0, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
    float pulse = 1.0 + sin(uTime * 0.8 + aIntensity * 5.0) * 0.12;
    gl_PointSize = uSize * aSize * uPixelRatio * pulse;
  }
`;

export const heatFragment = /* glsl */ `
  precision highp float;
  uniform vec3  uColor;
  uniform vec3  uColorDemo;
  uniform float uOpacity;
  varying float vFacing;
  varying float vIntensity;
  varying float vReal;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float shape = pow(1.0 - d, 2.2);
    float a = shape * uOpacity * vIntensity * mix(0.18, 1.0, vFacing);
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(uColorDemo, uColor, vReal), a);
  }
`;

/** Colonnes ascendantes : particules de lumière au-dessus du foyer. */
export const particleVertex = /* glsl */ `
  attribute vec3  aCenter;
  attribute float aOffset;   // 0 → 1 le long de la colonne
  attribute float aSeed;
  attribute float aIntensity;
  attribute float aReal;
  uniform float uTime;
  uniform float uHeight;
  uniform float uRise;
  uniform float uPixelRatio;
  uniform float uSize;
  varying float vAlpha;
  varying float vFacing;
  varying float vIntensity;
  varying float vReal;

  void main() {
    vec3 N = normalize(aCenter);
    vec3 V = normalize(cameraPosition - aCenter);
    vFacing = clamp(dot(N, V), 0.0, 1.0);
    vIntensity = aIntensity;
    vReal = clamp(aReal, 0.0, 1.0);

    float t = fract(aOffset + uTime * uRise * (0.5 + aSeed));
    vec3 pos = aCenter + N * uHeight * t;
    // léger serpentement
    pos += vec3(sin(uTime * 0.6 + aSeed * 9.0) * 0.004, 0.0, cos(uTime * 0.5 + aSeed * 7.0) * 0.004);

    vec4 world = modelMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_PointSize = uSize * (1.0 - t * 0.75) * uPixelRatio;
    vAlpha = pow(1.0 - t, 2.0);
  }
`;

export const particleFragment = /* glsl */ `
  precision highp float;
  uniform vec3  uColor;
  uniform vec3  uColorDemo;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vFacing;
  varying float vIntensity;
  varying float vReal;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float shape = smoothstep(1.0, 0.15, d);
    float a = shape * vAlpha * uOpacity * vIntensity * mix(0.2, 1.0, vFacing);
    if (a < 0.003) discard;
    gl_FragColor = vec4(mix(uColorDemo, uColor, vReal), a);
  }
`;

export const heatUniforms = {
  uSize: { value: CONFLICT.heat.size },
  uPixelRatio: { value: 1 },
  uTime: { value: 0 },
  uColor: { value: rgb(CONFLICT.heat.color) },
  uColorDemo: { value: rgb("#a385ff") },
  uOpacity: { value: CONFLICT.heat.opacity },
};

export const particleUniforms = {
  uTime: { value: 0 },
  uHeight: { value: CONFLICT.marker.columnHeight },
  uRise: { value: CONFLICT.marker.particleRise },
  uPixelRatio: { value: 1 },
  uSize: { value: 9 },
  uColor: { value: rgb("#ffb59c") },
  uColorDemo: { value: rgb("#c2aaff") },
  uOpacity: { value: 0.75 },
};
