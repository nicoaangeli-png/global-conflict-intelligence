import { GLOBE, rgb } from "@/lib/config/visual";

/**
 * Shader du corps de la planète.
 *
 * Surface volumique translucide : diffusion de base très sombre, Fresnel de
 * bord, scanlines presque invisibles, bruit animé subtil, pulsation lente et
 * terminateur jour/nuit doux. Le depth-write reste désactivé : la face
 * opposée du globe reste perceptible, ce qui produit l'effet « verre
 * holographique » plutôt qu'un solide opaque.
 */

export const hologramVertex = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDirW = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const hologramFragment = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec3  uBaseColor;
  uniform vec3  uRimColor;
  uniform float uFillOpacity;
  uniform float uFresnelPower;
  uniform float uFresnelIntensity;
  uniform float uScanlineFrequency;
  uniform float uScanlineIntensity;
  uniform float uNoiseScale;
  uniform float uNoiseIntensity;
  uniform float uPulseSpeed;
  uniform float uPulseAmplitude;
  uniform vec3  uLightDir;
  uniform float uTerminatorSoftness;
  uniform float uTerminatorStrength;
  uniform float uOpacity;

  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  varying vec2 vUv;
  varying vec3 vWorld;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(vViewDirW);
    float ndv = clamp(dot(N, V), 0.0, 1.0);

    // Fresnel de bord : le halo qui « découpe » la planète
    float fresnel = pow(1.0 - ndv, uFresnelPower);

    // Terminateur : éclairage très diffus, jamais un rendu PBR
    float lambert = dot(N, normalize(uLightDir));
    float dayNight = mix(1.0 - uTerminatorStrength, 1.0, smoothstep(-uTerminatorSoftness, uTerminatorSoftness, lambert));

    // Scanlines presque invisibles (repère de « système de projection »)
    float scan = sin(vUv.y * uScanlineFrequency + uTime * 0.35);
    scan = smoothstep(0.86, 1.0, scan) * uScanlineIntensity;

    // Bruit animé très léger : évite l'aplat numérique
    float n = vnoise(vec3(vWorld.xz * uNoiseScale, uTime * 0.05));
    n = (n - 0.5) * uNoiseIntensity;

    // Pulsation lente du volume
    float pulse = 1.0 + sin(uTime * uPulseSpeed * 6.2831853) * uPulseAmplitude;

    // Profondeur optique : plus « épais » sur les bords (sphère de verre)
    float thickness = mix(0.55, 1.0, fresnel);
    vec3 color = uBaseColor * uFillOpacity * thickness * dayNight * pulse;
    color += uRimColor * fresnel * uFresnelIntensity * dayNight;
    color += vec3(scan * dayNight);
    color += vec3(n);

    // Les bords restent plus lumineux : signature de l'hologramme
    float alpha = clamp(uOpacity * (0.35 + fresnel * 0.85), 0.0, 1.0);
    gl_FragColor = vec4(color, alpha);
  }
`;

export const hologramDefaults = {
  uTime: { value: 0 },
  uBaseColor: { value: rgb(GLOBE.body.baseColor) },
  uRimColor: { value: rgb(GLOBE.atmosphere.rimColor) },
  uFillOpacity: { value: GLOBE.body.fillOpacity },
  uFresnelPower: { value: GLOBE.body.fresnelPower },
  uFresnelIntensity: { value: GLOBE.body.fresnelIntensity },
  uScanlineFrequency: { value: GLOBE.body.scanlineFrequency },
  uScanlineIntensity: { value: GLOBE.body.scanlineIntensity },
  uNoiseScale: { value: GLOBE.body.noiseScale },
  uNoiseIntensity: { value: GLOBE.body.noiseIntensity },
  uPulseSpeed: { value: GLOBE.body.pulseSpeed },
  uPulseAmplitude: { value: GLOBE.body.pulseAmplitude },
  uLightDir: {
    value: [GLOBE.body.terminator.x, GLOBE.body.terminator.y, GLOBE.body.terminator.z] as [number, number, number],
  },
  uTerminatorSoftness: { value: GLOBE.body.terminator.softness },
  uTerminatorStrength: { value: GLOBE.body.terminator.strength },
  uOpacity: { value: 0.9 },
};
