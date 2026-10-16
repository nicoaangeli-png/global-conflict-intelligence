import * as THREE from 'three';
import { CONFLICT, GLOBE } from '@/lib/config/visual';
import { latLonToVector3 } from '@/lib/geo/latlon';
import {
  conflictVertex,
  conflictFragment,
  conflictUniforms,
  heatVertex,
  heatFragment,
  heatUniforms,
  particleVertex,
  particleFragment,
  particleUniforms,
} from '@/shaders/conflict';
import { ConflictCluster } from '@/types/conflict';

const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

export class ConflictLayer {
  public group: THREE.Group;
  private radius: number;
  private markerMesh: THREE.Mesh;
  private markerMaterial: THREE.ShaderMaterial;
  private heatPoints: THREE.Points;
  private heatMaterial: THREE.ShaderMaterial;
  private particlePoints: THREE.Points;
  private particleMaterial: THREE.ShaderMaterial;
  private clusters: ConflictCluster[] = [];
  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  private revealProgress: number = 1.0;

  constructor(radius: number) {
    this.group = new THREE.Group();
    this.radius = radius;

    // 1. Matériaux GPU
    this.markerMaterial = new THREE.ShaderMaterial({
      vertexShader: conflictVertex,
      fragmentShader: conflictFragment,
      uniforms: conflictUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    this.heatMaterial = new THREE.ShaderMaterial({
      vertexShader: heatVertex,
      fragmentShader: heatFragment,
      uniforms: heatUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    this.particleMaterial = new THREE.ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      uniforms: particleUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    // 2. Initialisation des Mesh
    this.markerMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.markerMaterial);
    this.markerMesh.frustumCulled = false;
    this.markerMesh.renderOrder = 20;

    this.heatPoints = new THREE.Points(new THREE.BufferGeometry(), this.heatMaterial);
    this.heatPoints.renderOrder = 8;

    this.particlePoints = new THREE.Points(new THREE.BufferGeometry(), this.particleMaterial);
    this.particlePoints.renderOrder = 9;

    this.group.add(this.heatPoints);
    this.group.add(this.particlePoints);
    this.group.add(this.markerMesh);
  }

  public setClusters(clusters: ConflictCluster[]): void {
    this.clusters = clusters;
    this.revealProgress = 0.0;

    const n = clusters.length;
    if (n === 0) {
      this.markerMesh.geometry.dispose();
      this.markerMesh.geometry = new THREE.BufferGeometry();
      this.heatPoints.geometry.dispose();
      this.heatPoints.geometry = new THREE.BufferGeometry();
      this.particlePoints.geometry.dispose();
      this.particlePoints.geometry = new THREE.BufferGeometry();
      return;
    }

    // A. Quads des marqueurs (4 sommets par foyer)
    const centers = new Float32Array(n * 4 * 3);
    const corners = new Float32Array(n * 4 * 2);
    const params = new Float32Array(n * 4 * 4);
    const reals = new Float32Array(n * 4);
    const indices: number[] = [];
    const v = new THREE.Vector3();

    clusters.forEach((c, i) => {
      latLonToVector3(c.latitude, c.longitude, this.radius * 1.02, v);
      const isSelected = c.id === this.selectedId ? 1 : c.id === this.hoveredId ? 0.5 : 0;
      for (let k = 0; k < 4; k++) {
        const vi = i * 4 + k;
        centers[vi * 3] = v.x;
        centers[vi * 3 + 1] = v.y;
        centers[vi * 3 + 2] = v.z;
        corners[vi * 2] = CORNERS[k][0];
        corners[vi * 2 + 1] = CORNERS[k][1];
        params[vi * 4] = c.intensity;
        params[vi * 4 + 1] = (i % 97) / 97;
        params[vi * 4 + 2] = isSelected;
        params[vi * 4 + 3] = ((i * 37) % 101) / 101;
        reals[vi] = c.realShare ?? 1;
      }
      const b = i * 4;
      indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });

    const markerGeo = new THREE.BufferGeometry();
    markerGeo.setAttribute('position', new THREE.BufferAttribute(centers, 3));
    markerGeo.setAttribute('aCenter', new THREE.BufferAttribute(centers, 3));
    markerGeo.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
    markerGeo.setAttribute('aParams', new THREE.BufferAttribute(params, 4));
    markerGeo.setAttribute('aReal', new THREE.BufferAttribute(reals, 1));
    markerGeo.setIndex(indices);
    markerGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 1.5);

    this.markerMesh.geometry.dispose();
    this.markerMesh.geometry = markerGeo;

    // B. Chaleur de surface
    const perCluster = 3;
    const nHeat = n * perCluster;
    const heatPositions = new Float32Array(nHeat * 3);
    const heatSizes = new Float32Array(nHeat);
    const heatIntensities = new Float32Array(nHeat);
    const heatReals = new Float32Array(nHeat);
    let hIdx = 0;

    clusters.forEach((c, ci) => {
      for (let k = 0; k < perCluster; k++) {
        const spread = k === 0 ? 0 : 0.55 * (0.4 + c.intensity);
        const angle = (ci * 2.399 + k * 2.094) % (Math.PI * 2);
        const lat = c.latitude + Math.sin(angle) * spread;
        const lon = c.longitude + Math.cos(angle) * spread * 1.3;
        latLonToVector3(lat, lon, this.radius * CONFLICT.heat.radius, v);
        heatPositions[hIdx * 3] = v.x;
        heatPositions[hIdx * 3 + 1] = v.y;
        heatPositions[hIdx * 3 + 2] = v.z;
        heatSizes[hIdx] = (k === 0 ? 1 : 0.62) * (0.5 + c.intensity);
        heatIntensities[hIdx] = (k === 0 ? 1 : 0.55) * (0.35 + c.intensity * 0.9);
        heatReals[hIdx] = c.realShare ?? 1;
        hIdx++;
      }
    });

    const heatGeo = new THREE.BufferGeometry();
    heatGeo.setAttribute('position', new THREE.BufferAttribute(heatPositions, 3));
    heatGeo.setAttribute('aSize', new THREE.BufferAttribute(heatSizes, 1));
    heatGeo.setAttribute('aIntensity', new THREE.BufferAttribute(heatIntensities, 1));
    heatGeo.setAttribute('aReal', new THREE.BufferAttribute(heatReals, 1));
    heatGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 1.5);

    this.heatPoints.geometry.dispose();
    this.heatPoints.geometry = heatGeo;

    // C. Particules de colonne lumineuse
    const perPart = CONFLICT.marker.particleCount;
    const nPart = n * perPart;
    const partCenters = new Float32Array(nPart * 3);
    const partOffsets = new Float32Array(nPart);
    const partSeeds = new Float32Array(nPart);
    const partIntensities = new Float32Array(nPart);
    const partReals = new Float32Array(nPart);
    let pIdx = 0;

    clusters.forEach((c, ci) => {
      latLonToVector3(c.latitude, c.longitude, this.radius * 1.021, v);
      for (let k = 0; k < perPart; k++) {
        partCenters[pIdx * 3] = v.x;
        partCenters[pIdx * 3 + 1] = v.y;
        partCenters[pIdx * 3 + 2] = v.z;
        partOffsets[pIdx] = (k + (ci % 5) / 5) / perPart;
        partSeeds[pIdx] = ((ci * 13 + k * 7) % 53) / 53;
        partIntensities[pIdx] = 0.35 + c.intensity * 0.8;
        partReals[pIdx] = c.realShare ?? 1;
        pIdx++;
      }
    });

    const partGeo = new THREE.BufferGeometry();
    partGeo.setAttribute('position', new THREE.BufferAttribute(partCenters, 3));
    partGeo.setAttribute('aCenter', new THREE.BufferAttribute(partCenters, 3));
    partGeo.setAttribute('aOffset', new THREE.BufferAttribute(partOffsets, 1));
    partGeo.setAttribute('aSeed', new THREE.BufferAttribute(partSeeds, 1));
    partGeo.setAttribute('aIntensity', new THREE.BufferAttribute(partIntensities, 1));
    partGeo.setAttribute('aReal', new THREE.BufferAttribute(partReals, 1));
    partGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 1.6);

    this.particlePoints.geometry.dispose();
    this.particlePoints.geometry = partGeo;
  }

  public setSelected(selectedId: string | null, hoveredId: string | null): void {
    this.selectedId = selectedId;
    this.hoveredId = hoveredId;

    if (!this.markerMesh.geometry.attributes.aParams) return;
    const attr = this.markerMesh.geometry.getAttribute('aParams') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;

    this.clusters.forEach((c, i) => {
      const sel = c.id === selectedId ? 1 : c.id === hoveredId ? 0.5 : 0;
      for (let k = 0; k < 4; k++) {
        arr[(i * 4 + k) * 4 + 2] = sel;
      }
    });
    attr.needsUpdate = true;
  }

  public update(time: number, delta: number, fov: number, height: number, dpr: number): void {
    this.revealProgress = Math.min(1.0, this.revealProgress + delta * 1.15);
    const pixelScale = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, height) / dpr;

    this.markerMaterial.uniforms.uTime.value = time;
    this.markerMaterial.uniforms.uReveal.value = this.revealProgress;
    this.markerMaterial.uniforms.uPixelScale.value = pixelScale;

    this.heatMaterial.uniforms.uTime.value = time;
    this.heatMaterial.uniforms.uPixelRatio.value = dpr;

    this.particleMaterial.uniforms.uTime.value = time;
    this.particleMaterial.uniforms.uPixelRatio.value = dpr;
  }

  public hitTest(raycaster: THREE.Raycaster, camera: THREE.Camera): ConflictCluster | null {
    if (this.clusters.length === 0) return null;

    const v = new THREE.Vector3();
    const ray = raycaster.ray;
    let closestDist = 0.08; // Seuil de sélection angulaire/sphérique
    let hitCluster: ConflictCluster | null = null;

    for (const cluster of this.clusters) {
      latLonToVector3(cluster.latitude, cluster.longitude, this.radius * 1.02, v);
      // Appliquer les transformations du groupe si présent
      v.applyMatrix4(this.group.matrixWorld);

      // Vérifier si le point fait face à la caméra
      const camDir = camera.position.clone().sub(v);
      if (camDir.dot(v) < 0) continue; // Face cachée

      const dist = ray.distanceToPoint(v);
      if (dist < closestDist) {
        closestDist = dist;
        hitCluster = cluster;
      }
    }

    return hitCluster;
  }

  public dispose(): void {
    this.markerMesh.geometry.dispose();
    this.markerMaterial.dispose();
    this.heatPoints.geometry.dispose();
    this.heatMaterial.dispose();
    this.particlePoints.geometry.dispose();
    this.particleMaterial.dispose();
  }
}
