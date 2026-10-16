import * as THREE from 'three';
import { GLOBE, rgb } from '@/lib/config/visual';
import { latLonToVector3 } from '@/lib/geo/latlon';
import { buildLandDots } from '@/lib/geo/landDots';
import { buildCityLights } from '@/lib/geo/cityLights';
import { buildWorldIndex } from '@/lib/geo/world';
import {
  hologramVertex,
  hologramFragment,
} from '@/shaders/hologram';
import {
  atmosphereVertex,
  atmosphereFragment,
} from '@/shaders/atmosphere';
import {
  pointsVertex,
  pointsFragment,
} from '@/shaders/points';

const borderLineVertex = /* glsl */ `
  varying float vFacing;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 N = normalize(mat3(modelMatrix) * normalize(position));
    vec3 V = normalize(cameraPosition - world.xyz);
    float facing = dot(N, V);
    if (facing < 0.035) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vFacing = 0.0;
      return;
    }
    vFacing = smoothstep(0.035, 0.22, facing);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const borderLineFragment = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFacing;
  void main() {
    if (vFacing < 0.01) discard;
    gl_FragColor = vec4(uColor, uOpacity * vFacing);
  }
`;

const graticuleVertex = /* glsl */ `
  varying float vFacing;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 N = normalize(mat3(modelMatrix) * normalize(position));
    vec3 V = normalize(cameraPosition - world.xyz);
    float facing = dot(N, V);
    if (facing < 0.035) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vFacing = 0.0;
      return;
    }
    vFacing = smoothstep(0.035, 0.25, facing);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const graticuleFragment = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFacing;
  void main() {
    if (vFacing < 0.01) discard;
    gl_FragColor = vec4(uColor, uOpacity * vFacing);
  }
`;

function makeGraticule(radius: number, step: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const v = new THREE.Vector3();
  const r = radius * 1.00045;

  for (let lon = -180; lon < 180; lon += step) {
    for (let lat = -90; lat < 90; lat += 3) {
      latLonToVector3(lat, lon, r, v);
      positions.push(v.x, v.y, v.z);
      latLonToVector3(Math.min(90, lat + 3), lon, r, v);
      positions.push(v.x, v.y, v.z);
    }
  }
  for (let lat = -75; lat <= 75; lat += step) {
    for (let lon = -180; lon < 180; lon += 4) {
      latLonToVector3(lat, lon, r, v);
      positions.push(v.x, v.y, v.z);
      latLonToVector3(lat, lon + 4, r, v);
      positions.push(v.x, v.y, v.z);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

export class HolographicEarth {
  public group: THREE.Group;
  private radius: number;
  private bodyMesh: THREE.Mesh;
  private bodyMaterial: THREE.ShaderMaterial;
  private haloMesh: THREE.Mesh;
  private haloMaterial: THREE.ShaderMaterial;
  private rimMesh: THREE.Mesh;
  private rimMaterial: THREE.ShaderMaterial;
  private landPoints: THREE.Points | null = null;
  private landMaterial: THREE.ShaderMaterial;
  private cityPoints: THREE.Points | null = null;
  private cityMaterial: THREE.ShaderMaterial;
  private borderLines: THREE.LineSegments | null = null;
  private borderMaterial: THREE.ShaderMaterial;
  private graticuleLines: THREE.LineSegments;
  private graticuleMaterial: THREE.ShaderMaterial;

  constructor(radius: number) {
    this.group = new THREE.Group();
    this.radius = radius;

    // 1. Halo atmosphérique diffus arrière
    const haloGeo = new THREE.SphereGeometry(radius * GLOBE.atmosphere.haloRadius, 64, 64);
    this.haloMaterial = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertex,
      fragmentShader: atmosphereFragment,
      uniforms: {
        uColor: { value: rgb(GLOBE.atmosphere.haloColor) },
        uIntensity: { value: GLOBE.atmosphere.haloIntensity },
        uPower: { value: GLOBE.atmosphere.haloPower },
        uTime: { value: 0 },
        uPulse: { value: 0.08 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    });
    this.haloMesh = new THREE.Mesh(haloGeo, this.haloMaterial);
    this.group.add(this.haloMesh);

    // 2. Corps de la planète : Shader océanique profond avec occlusion
    const bodyGeo = new THREE.SphereGeometry(radius, 128, 128);
    this.bodyMaterial = new THREE.ShaderMaterial({
      vertexShader: hologramVertex,
      fragmentShader: hologramFragment,
      uniforms: {
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
          value: [GLOBE.body.terminator.x, GLOBE.body.terminator.y, GLOBE.body.terminator.z],
        },
        uTerminatorSoftness: { value: GLOBE.body.terminator.softness },
        uTerminatorStrength: { value: GLOBE.body.terminator.strength },
        uOpacity: { value: 0.95 },
      },
      transparent: true,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
      blending: THREE.NormalBlending,
    });
    this.bodyMesh = new THREE.Mesh(bodyGeo, this.bodyMaterial);
    this.group.add(this.bodyMesh);

    // 3. Liséré atmosphérique net sur le limbe
    const rimGeo = new THREE.SphereGeometry(radius * GLOBE.atmosphere.outerRadius, 64, 64);
    this.rimMaterial = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertex,
      fragmentShader: atmosphereFragment,
      uniforms: {
        uColor: { value: rgb(GLOBE.atmosphere.rimColor) },
        uIntensity: { value: GLOBE.atmosphere.rimIntensity },
        uPower: { value: GLOBE.atmosphere.rimPower },
        uTime: { value: 0 },
        uPulse: { value: 0.05 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
    });
    this.rimMesh = new THREE.Mesh(rimGeo, this.rimMaterial);
    this.group.add(this.rimMesh);

    // 4. Grille sphérique avec occlusion de la face arrière
    const graticuleGeo = makeGraticule(radius, GLOBE.graticule.step);
    this.graticuleMaterial = new THREE.ShaderMaterial({
      vertexShader: graticuleVertex,
      fragmentShader: graticuleFragment,
      uniforms: {
        uColor: { value: rgb(GLOBE.graticule.color) },
        uOpacity: { value: GLOBE.graticule.opacity },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    this.graticuleLines = new THREE.LineSegments(graticuleGeo, this.graticuleMaterial);
    this.group.add(this.graticuleLines);

    // 5. Matières pour nuages de points avec occlusion stricte
    this.landMaterial = new THREE.ShaderMaterial({
      vertexShader: pointsVertex,
      fragmentShader: pointsFragment,
      uniforms: {
        uSize: { value: GLOBE.land.dotSize },
        uPixelRatio: { value: typeof window !== 'undefined' ? window.devicePixelRatio : 1 },
        uColorNear: { value: rgb(GLOBE.land.color) },
        uColorFar: { value: rgb(GLOBE.land.colorFar) },
        uOpacity: { value: GLOBE.land.opacity },
        uFacingFade: { value: GLOBE.land.facingFade },
        uBrightness: { value: 1.1 },
        uLightDir: {
          value: [GLOBE.body.terminator.x, GLOBE.body.terminator.y, GLOBE.body.terminator.z],
        },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    this.cityMaterial = new THREE.ShaderMaterial({
      vertexShader: pointsVertex,
      fragmentShader: pointsFragment,
      uniforms: {
        uSize: { value: GLOBE.cities.size },
        uPixelRatio: { value: typeof window !== 'undefined' ? window.devicePixelRatio : 1 },
        uColorNear: { value: rgb(GLOBE.cities.color) },
        uColorFar: { value: rgb('#2d6f9c') },
        uOpacity: { value: GLOBE.cities.opacity },
        uFacingFade: { value: 0.14 },
        uBrightness: { value: 1.2 },
        uLightDir: {
          value: [GLOBE.body.terminator.x, GLOBE.body.terminator.y, GLOBE.body.terminator.z],
        },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    // 6. Matière frontières avec occlusion stricte
    this.borderMaterial = new THREE.ShaderMaterial({
      vertexShader: borderLineVertex,
      fragmentShader: borderLineFragment,
      uniforms: {
        uColor: { value: rgb(GLOBE.borders.color) },
        uOpacity: { value: GLOBE.borders.opacity },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    // Chargement asynchrone des continents, villes et frontières
    this.loadGeographicLayers();
  }

  public getBodyMesh(): THREE.Mesh {
    return this.bodyMesh;
  }

  private async loadGeographicLayers(): Promise<void> {
    try {
      // Continents (nuage de points)
      const landData = await buildLandDots(GLOBE.land.dotCount);
      const landGeo = new THREE.BufferGeometry();
      landGeo.setAttribute('position', new THREE.BufferAttribute(landData.positions, 3));
      landGeo.setAttribute('aSize', new THREE.BufferAttribute(landData.sizes, 1));
      landGeo.setAttribute('aIntensity', new THREE.BufferAttribute(new Float32Array(landData.count).fill(1), 1));
      this.landPoints = new THREE.Points(landGeo, this.landMaterial);
      this.group.add(this.landPoints);

      // Villes et foyers urbains
      const placesRes = await fetch('/data/ne_110m_places.geojson');
      if (placesRes.ok) {
        const placesGj = await placesRes.json();
        const cityData = buildCityLights(placesGj);
        const cityGeo = new THREE.BufferGeometry();
        cityGeo.setAttribute('position', new THREE.BufferAttribute(cityData.positions, 3));
        cityGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(cityData.count).fill(1), 1));
        cityGeo.setAttribute('aIntensity', new THREE.BufferAttribute(cityData.intensities, 1));
        this.cityPoints = new THREE.Points(cityGeo, this.cityMaterial);
        this.group.add(this.cityPoints);
      }

      // Frontières administratives fines
      const countriesRes = await fetch('/data/ne_110m_countries.geojson');
      if (countriesRes.ok) {
        const countriesGj = await countriesRes.json();
        const worldIndex = buildWorldIndex(countriesGj, GLOBE.radius * 1.0009);
        const borderGeo = new THREE.BufferGeometry();
        borderGeo.setAttribute('position', new THREE.BufferAttribute(worldIndex.borderPositions, 3));
        this.borderLines = new THREE.LineSegments(borderGeo, this.borderMaterial);
        this.group.add(this.borderLines);
      }
    } catch (err) {
      console.warn('[HolographicEarth] Erreur lors du chargement des couches géo :', err);
    }
  }

  public update(time: number): void {
    this.bodyMaterial.uniforms.uTime.value = time;
    this.haloMaterial.uniforms.uTime.value = time;
    this.rimMaterial.uniforms.uTime.value = time;
  }

  public dispose(): void {
    this.bodyGeoDispose();
  }

  private bodyGeoDispose(): void {
    this.bodyMesh.geometry.dispose();
    this.bodyMaterial.dispose();
    this.haloMesh.geometry.dispose();
    this.haloMaterial.dispose();
    this.rimMesh.geometry.dispose();
    this.rimMaterial.dispose();
    this.graticuleLines.geometry.dispose();
    this.graticuleMaterial.dispose();
    this.borderMaterial.dispose();
    this.landMaterial.dispose();
    this.cityMaterial.dispose();
    if (this.landPoints) this.landPoints.geometry.dispose();
    if (this.cityPoints) this.cityPoints.geometry.dispose();
    if (this.borderLines) this.borderLines.geometry.dispose();
  }
}
