/**
 * Configuration visuelle centralisée.
 *
 * Aucune valeur magique dispersée : couleurs, intensités, opacités, vitesses,
 * tailles de marqueurs, bloom et seuils de clustering sont définis ici et
 * consommés par les shaders, les composants Three.js et l'interface 2D.
 */

/**
 * Conversion d'une couleur hexadécimale en triplet [0..1].
 * Les shaders attendent des vec3 bruts : aucune gestion colorimétrique
 * implicite ne doit s'appliquer aux uniformes.
 */
export function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const PALETTE = {
  /** Fond profond, quasi noir, bleu nuit. */
  void: "#01040a",
  abyss: "#02060f",
  deep: "#04101f",
  navy: "#062036",
  /** Hologramme : cyan froid. */
  ice: "#dff2ff",
  cyan: "#7fd4ff",
  cyanSoft: "#4aa3d8",
  cyanDim: "#2b6f9e",
  /** Structure / lignes techniques. */
  line: "rgba(127, 212, 255, 0.20)",
  lineSoft: "rgba(127, 212, 255, 0.09)",
  /** Conflit : rouge écarlate éclatant → orange feu selon l'intensité. */
  conflictLow: "#ff4733",
  conflictMid: "#ff2212",
  conflictHigh: "#ff7728",
  conflictCore: "#ffffff",
  /**
   * Foyers de conflit indexés : rouge alerte vif pour un repérage immédiat des zones de guerre.
   */
  demoLow: "#ff4d36",
  demoMid: "#ff2614",
  demoCore: "#ffffff",
  /** Texte. */
  text: "#dff1ff",
  textDim: "#8fb4cc",
  textFaint: "#4a6f88",
} as const;

/** Globe : géométrie et matières. */
export const GLOBE = {
  radius: 1,
  segments: 160,
  /** Couche atmosphérique : rayons et intensités. */
  atmosphere: {
    innerRadius: 1.001,
    outerRadius: 1.055,
    haloRadius: 1.22,
    rimColor: "#8fd8ff",
    haloColor: "#2f7fc4",
    rimPower: 3.1,
    rimIntensity: 0.85,
    haloIntensity: 0.22,
    haloPower: 2.2,
  },
  /** Corps de la planète : shader holographique. */
  body: {
    baseColor: "#031320",
    fillOpacity: 0.42,
    fresnelPower: 2.6,
    fresnelIntensity: 0.55,
    scanlineFrequency: 220,
    scanlineIntensity: 0.05,
    noiseScale: 5.5,
    noiseIntensity: 0.018,
    pulseSpeed: 0.16,
    pulseAmplitude: 0.06,
    /** Terminateur jour/nuit doux (direction de la lumière). */
    terminator: { x: -0.62, y: 0.38, z: 0.68, softness: 1.15, strength: 0.34 },
  },
  /** Continents en pointillé : « planète faite de données ». */
  land: {
    dotCount: 42000,
    dotSize: 1.3,
    dotSizeJitter: 0.55,
    color: "#bfe9ff",
    colorFar: "#2f7fb8",
    opacity: 0.72,
    /** Fondu des points sur la face cachée / les bords. */
    facingFade: 0.28,
  },
  /** Frontières administratives, trait extrêmement fin. */
  borders: {
    color: "#8fd8ff",
    opacity: 0.34,
    /** Sur-épaisseur de sélection. */
    selectedColor: "#ffffff",
    selectedOpacity: 0.9,
  },
  /** Lumières urbaines : réseau de points blancs. */
  cities: {
    color: "#eaf8ff",
    opacity: 1,
    size: 2.6,
    /** Densification autour de chaque ville selon sa population. */
    densityScale: 0.0022,
    maxPerCity: 26,
    minPopulation: 90_000,
  },
  /** Grille sphérique discrète. */
  graticule: {
    step: 15,
    color: "#7fd4ff",
    opacity: 0.055,
  },
} as const;

/** Couche de conflit. */
export const CONFLICT = {
  /** Seuils d'agrégation (rayon en degrés) selon le niveau de zoom caméra. */
  cluster: {
    /** distance caméra → rayon de regroupement (deg) */
    levels: [
      { distance: 2.4, degrees: 1.2 },
      { distance: 3.2, degrees: 2.4 },
      { distance: 4.1, degrees: 4.5 },
      { distance: 5.2, degrees: 8.0 },
      { distance: 6.4, degrees: 14.0 },
      { distance: 99, degrees: 22.0 },
    ],
    minEvents: 1,
  },
  marker: {
    /** Taille de base en pixels (constante à l'écran, indépendante du zoom). */
    coreSize: 5.6,
    coreSizeMax: 9.8,
    haloSize: 30,
    haloSizeMax: 52,
    ringSizeMax: 120,
    /** Opacités. */
    coreOpacity: 0.98,
    haloOpacity: 0.52,
    /** Pulsation : période et amplitude (secondes). */
    pulsePeriod: 3.4,
    pulseAmplitude: 0.18,
    /** Anneaux concentriques. */
    ringCount: 2,
    ringSpeed: 0.14,
    ringWidth: 0.03,
    /** Colonne lumineuse verticale. */
    columnHeight: 0.055,
    columnWidth: 1.6,
    /** Particules ascendantes. */
    particleCount: 3,
    particleRise: 0.11,
  },
  /** Intensité visuelle : jamais uniquement la taille. */
  intensity: {
    /** Poids relatifs des facteurs d'intensité. */
    weightEventCount: 0.42,
    weightFatalities: 0.36,
    weightRecency: 0.22,
    /** Bornes de normalisation. */
    eventCountCeil: 90,
    fatalitiesCeil: 900,
    recencyHalfLifeDays: 21,
    /** Luminosité et saturation selon l'intensité. */
    minLuminosity: 0.35,
    maxLuminosity: 1.0,
    hueShift: 0.06,
  },
  /** Barres d'intensité (interface 2D). */
  markerBarFrom: "#ff8a3d",
  markerBarTo: "#ff3b30",
  /** Incrustation surfacique (halo posé sur la sphère). */
  heat: {
    radius: 1.004,
    size: 8.5,
    opacity: 0.5,
    color: "#ff4a2f",
  },
} as const;

/** Orbits, anneaux et décor orbital (référence : structure fine et lente). */
export const ORBITS = {
  count: 5,
  radius: [1.16, 1.28, 1.42, 1.58, 1.9],
  inclination: [12, -34, 58, -72, 24],
  color: "#a9e0ff",
  opacity: 0.34,
  tickEvery: 6,
  tickLength: 0.02,
  /** Petits corps orbitaux (référence : satellites/mondes miniatures). */
  satellites: [
    { radius: 1.58, inclination: -72, phase: 0.35, size: 0.021, color: "#eaf7ff", speed: 0.045 },
    { radius: 1.9, inclination: 24, phase: 0.72, size: 0.013, color: "#9fd8ff", speed: 0.028 },
    { radius: 1.42, inclination: 58, phase: 0.12, size: 0.015, color: "#d6f0ff", speed: 0.06 },
    { radius: 1.28, inclination: -34, phase: 0.55, size: 0.009, color: "#8fd0ff", speed: 0.075 },
  ],
  speed: 0.012,
} as const;

export const STARFIELD = {
  count: 2600,
  innerRadius: 9,
  outerRadius: 26,
  size: 1.7,
  opacity: 0.85,
  color: "#dfefff",
  galaxy: {
    /** Bande galactique diffuse (référence : voile en haut à droite). */
    count: 2400,
    spread: 2.4,
    tilt: -0.42,
    size: 2.6,
    opacity: 0.2,
    color: "#7fb8ff",
  },
} as const;

/** Caméra et contrôles. */
export const CAMERA = {
  fov: 34,
  near: 0.01,
  far: 120,
  initial: { distance: 4.2, theta: 2.62, phi: 1.3 },
  minDistance: 1.8,
  maxDistance: 8,
  /** Inertie. */
  damping: 0.86,
  rotateSpeed: 0.0032,
  zoomSpeed: 0.0011,
  /** Rotation automatique quand l'utilisateur ne touche pas la scène. */
  autoRotate: { speed: 0.028, resumeAfterMs: 4200 },
  /** Amortissement du recentrage sur un foyer. */
  flyTo: { duration: 1.5, ease: "power3.inOut" },
} as const;

/** Post-traitement (bloom très contrôlé). */
export const POST = {
  bloom: {
    intensity: 0.5,
    luminanceThreshold: 0.3,
    luminanceSmoothing: 0.34,
    mipmapBlur: true,
    radius: 0.62,
  },
  vignette: { darkness: 0.42, offset: 0.32 },
  noise: { opacity: 0.022 },
} as const;

/** Interface 2D. */
export const UI = {
  panelWidth: 268,
  grid: 8,
  transition: { fast: 0.18, base: 0.32, slow: 0.6 },
} as const;
