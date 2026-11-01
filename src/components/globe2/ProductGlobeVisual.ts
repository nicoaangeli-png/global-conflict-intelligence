import type * as ThreeTypes from "three";
import { GLOBE, ORBITS } from "@/lib/config/visual";
import { toEcef, WGS84_A_M } from "@/lib/globe2/geo";
import { hologramVertex, hologramFragment, hologramDefaults } from "@/shaders/hologram";
import { atmosphereVertex, atmosphereFragment, atmosphereHaloDefaults, atmosphereRimDefaults } from "@/shaders/atmosphere";
import { pointsVertex, pointsFragment, landDotUniforms, cityUniforms } from "@/shaders/points";

const MASK_WIDTH = 2048;
const MASK_HEIGHT = 1024;

function isLand(mask: Uint8Array, latitude: number, longitude: number): boolean {
  const col = Math.floor((longitude + 180) / 360 * MASK_WIDTH);
  const row = Math.floor((90 - latitude) / 180 * MASK_HEIGHT);
  if (row < 0 || row >= MASK_HEIGHT || col < 0 || col >= MASK_WIDTH) return false;
  const index = row * MASK_WIDTH + col;
  return ((mask[index >> 3] >> (index & 7)) & 1) === 1;
}

function appendEcef(positions: number[], latitude: number, longitude: number, heightM: number): void {
  const point = toEcef({ latDeg: latitude, lonDeg: longitude, heightM, datum: "WGS84" });
  positions.push(point.x, point.z, -point.y);
}

function landPoints(THREE: typeof ThreeTypes, mask: Uint8Array): ThreeTypes.BufferGeometry {
  if (mask.byteLength !== MASK_WIDTH * MASK_HEIGHT / 8) throw new Error("Masque terrestre local invalide");
  const positions: number[] = [], sizes: number[] = [], intensities: number[] = [];
  const target = GLOBE.land.dotCount;
  const samples = Math.ceil(target / 0.28);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < samples && sizes.length < target; i++) {
    const z = 1 - 2 * (i + 0.5) / samples;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const angle = i * golden;
    const lat = Math.asin(z) * 180 / Math.PI;
    const lon = Math.atan2(r * Math.sin(angle), r * Math.cos(angle)) * 180 / Math.PI;
    if (!isLand(mask, lat, lon)) continue;
    appendEcef(positions, lat, lon, 4_000);
    sizes.push(0.8 + (i % 17) / 35);
    intensities.push(1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute("aIntensity", new THREE.Float32BufferAttribute(intensities, 1));
  return geometry;
}

type Place = { geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> };
type PlaceCollection = { features?: Place[] };

function cityPoints(THREE: typeof ThreeTypes, input: unknown): ThreeTypes.BufferGeometry {
  const collection = input as PlaceCollection;
  if (!collection || !Array.isArray(collection.features)) throw new Error("Villes Natural Earth invalides");
  const positions: number[] = [], sizes: number[] = [], intensities: number[] = [];
  for (const place of collection.features) {
    const coordinates = place.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const [lon, lat] = coordinates;
    if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)
      || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const rawPopulation = place.properties?.POP_MAX;
    const population = typeof rawPopulation === "number" ? rawPopulation : Number(rawPopulation);
    if (!Number.isFinite(population) || population < GLOBE.cities.minPopulation) continue;
    appendEcef(positions, lat, lon, 6_000);
    sizes.push(1);
    intensities.push(Math.min(1, 0.4 + Math.log10(Math.max(1, population)) / 12));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute("aIntensity", new THREE.Float32BufferAttribute(intensities, 1));
  return geometry;
}

/** Existing ORBITAL shaders on a Geo Core ellipsoid. No legacy camera or spherical projection. */
export class ProductGlobeVisual {
  readonly group: ThreeTypes.Group;
  private readonly THREE: typeof ThreeTypes;
  private readonly body: ThreeTypes.Mesh;
  private readonly bodyMaterial: ThreeTypes.ShaderMaterial;
  private readonly occluderMaterial: ThreeTypes.MeshBasicMaterial;
  private readonly haloMaterial: ThreeTypes.ShaderMaterial;
  private readonly rimMaterial: ThreeTypes.ShaderMaterial;
  private readonly pointMaterial: ThreeTypes.ShaderMaterial;
  private readonly cityMaterial: ThreeTypes.ShaderMaterial;
  private readonly orbitMaterial: ThreeTypes.LineBasicMaterial;
  private readonly ownedGeometries: ThreeTypes.BufferGeometry[] = [];
  private land: ThreeTypes.Points | null = null;
  private cities: ThreeTypes.Points | null = null;
  private readonly orbits: ThreeTypes.Group;

  constructor(THREE: typeof ThreeTypes, ellipsoid: ThreeTypes.BufferGeometry, pixelRatio: number) {
    this.THREE = THREE;
    this.group = new THREE.Group();
    // Opaque render pass, depth only: near-side WGS84 surface hides geographic
    // lines and orbit segments behind the planet without painting a solid disk.
    this.occluderMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true,
      depthTest: true, side: THREE.FrontSide });
    const occluder = new THREE.Mesh(ellipsoid, this.occluderMaterial);
    occluder.renderOrder = -1;
    this.group.add(occluder);
    // The visible shell occupies exactly the same surface: bypass its own
    // depth comparison to avoid z-fighting, while geographic layers still test
    // against the occluder.
    this.bodyMaterial = new THREE.ShaderMaterial({ vertexShader: hologramVertex, fragmentShader: hologramFragment,
      uniforms: THREE.UniformsUtils.clone(hologramDefaults), transparent: true, depthWrite: false,
      depthTest: false });
    // The original noise frequency is configured for a unit sphere.
    this.bodyMaterial.uniforms.uNoiseScale.value = GLOBE.body.noiseScale / WGS84_A_M;
    // The lab's full-scale WGS84 globe has no opaque surface at orbital distance.
    // Give the translucent body a readable deep-cyan fill without restoring a black disk.
    this.bodyMaterial.uniforms.uBaseColor.value = new THREE.Color(0x398fb8);
    this.bodyMaterial.uniforms.uFillOpacity.value = 1;
    this.body = new THREE.Mesh(ellipsoid, this.bodyMaterial);
    this.group.add(this.body);

    // The back face of this enlarged shell lights the whole disk around the planet,
    // making its centre look like a black hole. The front face leaves only the limb.
    this.haloMaterial = new THREE.ShaderMaterial({ vertexShader: atmosphereVertex, fragmentShader: atmosphereFragment,
      uniforms: THREE.UniformsUtils.clone(atmosphereHaloDefaults), transparent: true, depthWrite: false,
      depthTest: false, side: THREE.FrontSide, blending: THREE.AdditiveBlending });
    const halo = new THREE.Mesh(ellipsoid, this.haloMaterial);
    halo.scale.setScalar(GLOBE.atmosphere.haloRadius);
    this.group.add(halo);
    this.rimMaterial = new THREE.ShaderMaterial({ vertexShader: atmosphereVertex, fragmentShader: atmosphereFragment,
      uniforms: THREE.UniformsUtils.clone(atmosphereRimDefaults), transparent: true, depthWrite: false,
      side: THREE.FrontSide, blending: THREE.AdditiveBlending });
    const rim = new THREE.Mesh(ellipsoid, this.rimMaterial);
    rim.scale.setScalar(GLOBE.atmosphere.outerRadius);
    this.group.add(rim);

    this.pointMaterial = new THREE.ShaderMaterial({ vertexShader: pointsVertex, fragmentShader: pointsFragment,
      uniforms: THREE.UniformsUtils.clone(landDotUniforms), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending });
    this.cityMaterial = new THREE.ShaderMaterial({ vertexShader: pointsVertex, fragmentShader: pointsFragment,
      uniforms: THREE.UniformsUtils.clone(cityUniforms), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending });
    this.setPixelRatio(pixelRatio);

    this.orbits = new THREE.Group();
    this.orbitMaterial = new THREE.LineBasicMaterial({ color: ORBITS.color,
      transparent: true, opacity: ORBITS.opacity * 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let index = 0; index < 3; index++) {
      const positions: number[] = [];
      const radius = WGS84_A_M * ORBITS.radius[index];
      const inclination = ORBITS.inclination[index] * Math.PI / 180;
      for (let step = 0; step <= 256; step++) {
        const angle = step / 256 * 2 * Math.PI;
        positions.push(radius * Math.cos(angle), radius * Math.sin(angle) * Math.sin(inclination),
          radius * Math.sin(angle) * Math.cos(inclination));
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      this.ownedGeometries.push(geometry);
      this.orbits.add(new THREE.Line(geometry, this.orbitMaterial));
    }
    this.group.add(this.orbits);
  }

  setPixelRatio(value: number): void {
    this.pointMaterial.uniforms.uPixelRatio.value = value;
    this.cityMaterial.uniforms.uPixelRatio.value = value;
  }

  async load(signal: AbortSignal): Promise<void> {
    const [maskResponse, citiesResponse] = await Promise.all([
      fetch("/data/land_mask.bin", { signal }), fetch("/data/ne_110m_places.geojson", { signal }),
    ]);
    if (!maskResponse.ok || !citiesResponse.ok) throw new Error("Assets géographiques locaux indisponibles");
    const [mask, places] = await Promise.all([maskResponse.arrayBuffer(), citiesResponse.json() as Promise<unknown>]);
    if (signal.aborted) return;
    const landGeometry = landPoints(this.THREE, new Uint8Array(mask));
    const cityGeometry = cityPoints(this.THREE, places);
    if (signal.aborted) { landGeometry.dispose(); cityGeometry.dispose(); return; }
    this.ownedGeometries.push(landGeometry, cityGeometry);
    this.land = new this.THREE.Points(landGeometry, this.pointMaterial);
    this.cities = new this.THREE.Points(cityGeometry, this.cityMaterial);
    this.group.add(this.land, this.cities);
  }

  update(timeSeconds: number, distanceM: number): void {
    this.bodyMaterial.uniforms.uTime.value = timeSeconds;
    this.haloMaterial.uniforms.uTime.value = timeSeconds;
    this.rimMaterial.uniforms.uTime.value = timeSeconds;
    this.orbits.visible = distanceM > 3_000_000;
    if (this.land) this.land.visible = distanceM > 200_000;
    if (this.cities) this.cities.visible = distanceM > 100_000;
  }

  dispose(): void {
    for (const geometry of this.ownedGeometries) geometry.dispose();
    this.occluderMaterial.dispose(); this.bodyMaterial.dispose(); this.haloMaterial.dispose(); this.rimMaterial.dispose();
    this.pointMaterial.dispose(); this.cityMaterial.dispose(); this.orbitMaterial.dispose();
  }
}
