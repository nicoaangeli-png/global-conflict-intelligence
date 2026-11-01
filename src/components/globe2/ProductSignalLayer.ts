import type * as ThreeTypes from "three";
import { CONFLICT, PALETTE } from "@/lib/config/visual";
import { ageBrightness, isLive, THEME_COLORS } from "@/components/feeds/feedModel";
import { toEcef, WGS84_A_M, WGS84_B_M } from "@/lib/globe2/geo";
import { conflictFragment, conflictUniforms, conflictVertex, heatFragment, heatUniforms,
  heatVertex, particleFragment, particleUniforms, particleVertex } from "@/shaders/conflict";
import type { ConflictCluster } from "@/types/conflict";
import type { LiveItem } from "@/types/feeds";

export type SignalHit = { kind: "conflict"; cluster: ConflictCluster } | { kind: "feed"; item: LiveItem };

const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
const position = (lat: number, lon: number, heightM: number): [number, number, number] => {
  const p = toEcef({ latDeg: lat, lonDeg: lon === 180 ? -180 : lon, heightM, datum: "WGS84" });
  return [p.x, p.z, -p.y];
};

// Preserve the production signal shader, with its camera-facing test evaluated
// relative to Globe2's floating origin instead of the old unit sphere.
const markerVertex = conflictVertex
  .replace("vec3 V = normalize(cameraPosition - aCenter);", "vec3 V = normalize(cameraPosition - (modelMatrix * vec4(aCenter, 1.0)).xyz);")
  .replace("vec4 mv = viewMatrix * vec4(aCenter, 1.0);", "vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);");
const columnVertex = particleVertex
  .replace("vec3 V = normalize(cameraPosition - aCenter);", "vec3 V = normalize(cameraPosition - (modelMatrix * vec4(aCenter, 1.0)).xyz);");

// Same small, category-coloured points and freshness pulse as the production
// FeedLayer. The ellipsoid's depth-only shell performs back-side occlusion.
const feedVertex = /* glsl */ `
  uniform float uPixelRatio;
  attribute vec3 aColor;
  attribute float aBright;
  attribute float aLive;
  attribute float aSel;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vBright;
  varying float vLive;
  varying float vSel;
  varying float vFacing;
  varying float vSeed;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 normal = normalize(vec3(position.x / ${WGS84_A_M.toFixed(1)}, position.y / ${WGS84_B_M.toFixed(1)}, position.z / ${WGS84_A_M.toFixed(1)}));
    vFacing = dot(normal, normalize(cameraPosition - world.xyz));
    vColor = aColor; vBright = aBright; vLive = aLive; vSel = aSel; vSeed = aSeed;
    gl_Position = projectionMatrix * viewMatrix * world;
    float core = 7.0 + aSel * 5.0;
    gl_PointSize = (aLive > 0.5 ? core * 3.2 : core) * uPixelRatio;
  }
`;
const feedFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vColor;
  varying float vBright;
  varying float vLive;
  varying float vSel;
  varying float vFacing;
  varying float vSeed;
  void main() {
    if (vFacing < 0.04) discard;
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float r = length(uv);
    float rc = r * (vLive > 0.5 ? 3.2 : 1.0);
    float core = smoothstep(1.0, 0.5, rc);
    float ring = 0.0;
    if (vLive > 0.5) {
      float phase = fract(uTime * 0.55 + vSeed);
      ring = smoothstep(0.09, 0.0, abs(r - phase)) * (1.0 - phase) * 0.95;
    }
    float outline = vSel > 0.0 ? smoothstep(0.16, 0.0, abs(rc - 1.05)) * vSel : 0.0;
    float alpha = (core * vBright + ring + outline) * smoothstep(0.04, 0.22, vFacing);
    if (alpha < 0.01) discard;
    vec3 color = mix(vColor, vec3(1.0), core * 0.3 * vBright + outline * 0.6);
    gl_FragColor = vec4(color, min(alpha, 1.0));
  }
`;

/** Production signal language on Geo Core WGS84/ECEF; no legacy projection. */
export class ProductSignalLayer {
  readonly group: ThreeTypes.Group;
  private readonly THREE: typeof ThreeTypes;
  private readonly markers: ThreeTypes.Mesh;
  private readonly markerMaterial: ThreeTypes.ShaderMaterial;
  private readonly heat: ThreeTypes.Points;
  private readonly heatMaterial: ThreeTypes.ShaderMaterial;
  private readonly particles: ThreeTypes.Points;
  private readonly particleMaterial: ThreeTypes.ShaderMaterial;
  private readonly feeds: ThreeTypes.Points;
  private readonly feedMaterial: ThreeTypes.ShaderMaterial;
  private clusters: ConflictCluster[] = [];
  private items: LiveItem[] = [];
  private pickables: { point: ThreeTypes.Vector3; hit: SignalHit }[] = [];
  private selectedId: string | null = null;
  private hoveredId: string | null = null;

  constructor(THREE: typeof ThreeTypes, _pixelRatio: number) {
    this.THREE = THREE;
    this.group = new THREE.Group();
    this.markerMaterial = new THREE.ShaderMaterial({ vertexShader: markerVertex, fragmentShader: conflictFragment,
      uniforms: THREE.UniformsUtils.clone(conflictUniforms), transparent: true, depthWrite: false,
      depthTest: true, blending: THREE.AdditiveBlending });
    this.markers = new THREE.Mesh(new THREE.BufferGeometry(), this.markerMaterial);
    this.markers.frustumCulled = false; this.markers.renderOrder = 20;
    this.heatMaterial = new THREE.ShaderMaterial({ vertexShader: heatVertex, fragmentShader: heatFragment,
      uniforms: THREE.UniformsUtils.clone(heatUniforms), transparent: true, depthWrite: false,
      depthTest: true, blending: THREE.AdditiveBlending });
    this.heat = new THREE.Points(new THREE.BufferGeometry(), this.heatMaterial);
    this.heat.renderOrder = 8;
    this.particleMaterial = new THREE.ShaderMaterial({ vertexShader: columnVertex, fragmentShader: particleFragment,
      uniforms: THREE.UniformsUtils.clone(particleUniforms), transparent: true, depthWrite: false,
      depthTest: true, blending: THREE.AdditiveBlending });
    this.particleMaterial.uniforms.uHeight.value = CONFLICT.marker.columnHeight * WGS84_A_M;
    this.particles = new THREE.Points(new THREE.BufferGeometry(), this.particleMaterial);
    this.particles.renderOrder = 9;
    this.feedMaterial = new THREE.ShaderMaterial({ vertexShader: feedVertex, fragmentShader: feedFragment,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } }, transparent: true,
      depthWrite: false, depthTest: true });
    this.feeds = new THREE.Points(new THREE.BufferGeometry(), this.feedMaterial);
    this.feeds.frustumCulled = false; this.feeds.renderOrder = 22;
    this.group.add(this.heat, this.particles, this.markers, this.feeds);
  }

  setData(clusters: ConflictCluster[], items: LiveItem[], now = Date.now()): void {
    this.clusters = clusters;
    this.items = items.filter(item => item.lat !== null && item.lon !== null
      && Number.isFinite(item.lat) && Number.isFinite(item.lon)
      && item.lat >= -90 && item.lat <= 90 && item.lon >= -180 && item.lon <= 180);
    this.pickables = [
      ...this.clusters.map(cluster => ({ point: new this.THREE.Vector3(...position(cluster.latitude, cluster.longitude, 14_000)),
        hit: { kind: "conflict" as const, cluster } })),
      ...this.items.map(item => ({ point: new this.THREE.Vector3(...position(item.lat!, item.lon!, 18_000)),
        hit: { kind: "feed" as const, item } })),
    ];
    this.buildConflicts();
    this.buildFeeds(now);
  }

  private buildConflicts(): void {
    const THREE = this.THREE;
    const n = this.clusters.length;
    const centers = new Float32Array(n * 12), quadCorners = new Float32Array(n * 8);
    const params = new Float32Array(n * 16), reals = new Float32Array(n * 4);
    const indices: number[] = [];
    const heatPositions = new Float32Array(n * 9), heatSizes = new Float32Array(n * 3);
    const heatIntensities = new Float32Array(n * 3), heatReals = new Float32Array(n * 3);
    const perPart = CONFLICT.marker.particleCount;
    const partCenters = new Float32Array(n * perPart * 3);
    const partOffsets = new Float32Array(n * perPart), partSeeds = new Float32Array(n * perPart);
    const partIntensities = new Float32Array(n * perPart), partReals = new Float32Array(n * perPart);
    this.clusters.forEach((cluster, i) => {
      const p = position(cluster.latitude, cluster.longitude, 14_000);
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        centers.set(p, v * 3); quadCorners.set(corners[k], v * 2);
        params.set([cluster.intensity, (i % 97) / 97, this.highlight(cluster.id), ((i * 37) % 101) / 101], v * 4);
        reals[v] = cluster.realShare ?? 1;
      }
      const b = i * 4; indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
      for (let k = 0; k < 3; k++) {
        const spread = k === 0 ? 0 : 0.55 * (0.4 + cluster.intensity);
        const angle = (i * 2.399 + k * 2.094) % (Math.PI * 2);
        const lat = Math.max(-90, Math.min(90, cluster.latitude + Math.sin(angle) * spread));
        const lon = ((cluster.longitude + Math.cos(angle) * spread * 1.3 + 540) % 360) - 180;
        const h = i * 3 + k;
        heatPositions.set(position(lat, lon, 25_000), h * 3);
        heatSizes[h] = (k === 0 ? 1 : 0.62) * (0.5 + cluster.intensity);
        heatIntensities[h] = (k === 0 ? 1 : 0.55) * (0.35 + cluster.intensity * 0.9);
        heatReals[h] = cluster.realShare ?? 1;
      }
      for (let k = 0; k < perPart; k++) {
        const v = i * perPart + k;
        partCenters.set(p, v * 3);
        partOffsets[v] = (k + (i % 5) / 5) / perPart;
        partSeeds[v] = ((i * 13 + k * 7) % 53) / 53;
        partIntensities[v] = 0.35 + cluster.intensity * 0.8;
        partReals[v] = cluster.realShare ?? 1;
      }
    });
    const marker = new THREE.BufferGeometry();
    marker.setAttribute("position", new THREE.BufferAttribute(centers, 3));
    marker.setAttribute("aCenter", new THREE.BufferAttribute(centers, 3));
    marker.setAttribute("aCorner", new THREE.BufferAttribute(quadCorners, 2));
    marker.setAttribute("aParams", new THREE.BufferAttribute(params, 4));
    marker.setAttribute("aReal", new THREE.BufferAttribute(reals, 1)); marker.setIndex(indices);
    this.markers.geometry.dispose(); this.markers.geometry = marker;
    const heat = new THREE.BufferGeometry();
    heat.setAttribute("position", new THREE.BufferAttribute(heatPositions, 3));
    heat.setAttribute("aSize", new THREE.BufferAttribute(heatSizes, 1));
    heat.setAttribute("aIntensity", new THREE.BufferAttribute(heatIntensities, 1));
    heat.setAttribute("aReal", new THREE.BufferAttribute(heatReals, 1));
    this.heat.geometry.dispose(); this.heat.geometry = heat;
    const part = new THREE.BufferGeometry();
    part.setAttribute("position", new THREE.BufferAttribute(partCenters, 3));
    part.setAttribute("aCenter", new THREE.BufferAttribute(partCenters, 3));
    part.setAttribute("aOffset", new THREE.BufferAttribute(partOffsets, 1));
    part.setAttribute("aSeed", new THREE.BufferAttribute(partSeeds, 1));
    part.setAttribute("aIntensity", new THREE.BufferAttribute(partIntensities, 1));
    part.setAttribute("aReal", new THREE.BufferAttribute(partReals, 1));
    this.particles.geometry.dispose(); this.particles.geometry = part;
  }

  private buildFeeds(now: number): void {
    const THREE = this.THREE;
    const n = this.items.length;
    const positions = new Float32Array(n * 3), colors = new Float32Array(n * 3);
    const bright = new Float32Array(n), live = new Float32Array(n), sel = new Float32Array(n), seeds = new Float32Array(n);
    const color = new THREE.Color();
    this.items.forEach((item, i) => {
      positions.set(position(item.lat!, item.lon!, 18_000), i * 3);
      const critical = item.nature === "official_alert" && (item.severity === "severe" || item.severity === "extreme");
      color.set(critical ? PALETTE.conflictLow : THEME_COLORS[item.category]);
      colors.set([color.r, color.g, color.b], i * 3);
      bright[i] = ageBrightness(item, now); live[i] = isLive(item, now) ? 1 : 0;
      sel[i] = this.highlight(item.id); seeds[i] = ((i * 37) % 101) / 101;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("aBright", new THREE.BufferAttribute(bright, 1));
    geo.setAttribute("aLive", new THREE.BufferAttribute(live, 1));
    geo.setAttribute("aSel", new THREE.BufferAttribute(sel, 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    this.feeds.geometry.dispose(); this.feeds.geometry = geo;
  }

  private highlight(id: string): number { return id === this.selectedId ? 1 : id === this.hoveredId ? 0.5 : 0; }

  setHighlight(selectedId: string | null, hoveredId: string | null): void {
    this.selectedId = selectedId; this.hoveredId = hoveredId;
    const params = this.markers.geometry.getAttribute("aParams");
    if (params) {
      const array = params.array as Float32Array;
      this.clusters.forEach((cluster, i) => {
        for (let k = 0; k < 4; k++) array[(i * 4 + k) * 4 + 2] = this.highlight(cluster.id);
      });
      params.needsUpdate = true;
    }
    const sel = this.feeds.geometry.getAttribute("aSel");
    if (sel) {
      const array = sel.array as Float32Array;
      this.items.forEach((item, i) => { array[i] = this.highlight(item.id); });
      sel.needsUpdate = true;
    }
  }

  update(time: number, delta: number, fovDeg: number, height: number, dpr: number): void {
    this.markerMaterial.uniforms.uTime.value = time;
    this.markerMaterial.uniforms.uPixelScale.value = 2 * Math.tan(fovDeg * Math.PI / 360) / Math.max(1, height) / dpr;
    this.markerMaterial.uniforms.uReveal.value = Math.min(1, this.markerMaterial.uniforms.uReveal.value + delta * 1.15);
    this.heatMaterial.uniforms.uTime.value = time;
    this.heatMaterial.uniforms.uPixelRatio.value = dpr;
    this.particleMaterial.uniforms.uTime.value = time;
    this.particleMaterial.uniforms.uPixelRatio.value = dpr;
    this.feedMaterial.uniforms.uTime.value = time;
    this.feedMaterial.uniforms.uPixelRatio.value = dpr;
  }

  /** Analytic screen-space hit test, with WGS84 back-hemisphere rejection. */
  hitTest(camera: ThreeTypes.Camera, pointer: ThreeTypes.Vector2, width: number, height: number): SignalHit | null {
    if (width <= 0 || height <= 0) return null;
    camera.updateWorldMatrix(true, false); this.group.updateWorldMatrix(true, false);
    const eye = this.group.worldToLocal(camera.getWorldPosition(new this.THREE.Vector3()));
    const projected = new this.THREE.Vector3();
    let best = 12, hit: SignalHit | null = null;
    const test = (p: ThreeTypes.Vector3, candidate: SignalHit) => {
      // Ellipsoid surface normal in the render-axis convention (x, z, -y).
      const facing = (eye.x - p.x) * p.x / (WGS84_A_M * WGS84_A_M)
        + (eye.y - p.y) * p.y / (WGS84_B_M * WGS84_B_M)
        + (eye.z - p.z) * p.z / (WGS84_A_M * WGS84_A_M);
      if (facing <= 0) return;
      projected.copy(p).applyMatrix4(this.group.matrixWorld).project(camera);
      if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1) return;
      const distance = Math.hypot((projected.x - pointer.x) * width / 2, (projected.y - pointer.y) * height / 2);
      if (distance < best) { best = distance; hit = candidate; }
    };
    for (const candidate of this.pickables) test(candidate.point, candidate.hit);
    return hit;
  }

  dispose(): void {
    for (const mesh of [this.markers, this.heat, this.particles, this.feeds]) mesh.geometry.dispose();
    for (const material of [this.markerMaterial, this.heatMaterial, this.particleMaterial, this.feedMaterial]) material.dispose();
  }
}
