import * as THREE from 'three';
import { latLonToVector3 } from '@/lib/geo/latlon';
import type { LiveItem } from '@/types/feeds';
import { THEME_COLORS, ageBrightness, isLive } from '../feeds/feedModel';

/**
 * Calque des flux mondiaux géolocalisés (séismes, cyclones, manifestations,
 * lancements…) : un point par élément, couleur de sa catégorie, halo pulsant
 * s'il date de moins de 2 h, éclat décroissant avec l'âge.
 *
 * Indépendant du rendu de la Terre : un seul `THREE.Points` posé au-dessus de
 * la sphère, faces cachées éliminées dans le shader (aucun test de profondeur).
 */

const vertex = /* glsl */ `
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
    vFacing = dot(normalize(world.xyz), normalize(cameraPosition - world.xyz));
    vColor = aColor;
    vBright = aBright;
    vLive = aLive;
    vSel = aSel;
    vSeed = aSeed;
    gl_Position = projectionMatrix * viewMatrix * world;
    float core = 7.0 + aSel * 5.0;
    // Un point « en direct » réserve la place de son halo (3,2 × le cœur).
    gl_PointSize = (aLive > 0.5 ? core * 3.2 : core) * uPixelRatio;
  }
`;

const fragment = /* glsl */ `
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
    float scale = vLive > 0.5 ? 3.2 : 1.0;
    float rc = r * scale;
    float core = smoothstep(1.0, 0.5, rc);
    float ring = 0.0;
    if (vLive > 0.5) {
      float phase = fract(uTime * 0.55 + vSeed);
      ring = smoothstep(0.09, 0.0, abs(r - phase)) * (1.0 - phase) * 0.95;
    }
    float outline = vSel > 0.0 ? smoothstep(0.16, 0.0, abs(rc - 1.05)) * vSel : 0.0;
    float edge = smoothstep(0.04, 0.22, vFacing);
    float alpha = (core * vBright + ring + outline) * edge;
    if (alpha < 0.01) discard;
    vec3 color = mix(vColor, vec3(1.0), core * 0.3 * vBright + outline * 0.6);
    gl_FragColor = vec4(color, min(alpha, 1.0));
  }
`;

export class FeedLayer {
  public group: THREE.Group;
  private radius: number;
  private points: THREE.Points;
  private material: THREE.ShaderMaterial;
  private items: LiveItem[] = [];
  private selectedId: string | null = null;
  private hoveredId: string | null = null;

  constructor(radius: number) {
    this.radius = radius;
    this.group = new THREE.Group();
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 22;
    this.group.add(this.points);
  }

  /** Remplace les éléments affichés (seuls ceux qui ont des coordonnées sont retenus). */
  public setItems(items: LiveItem[], now = Date.now()): void {
    this.items = items.filter((item) => item.lat !== null && item.lon !== null && Number.isFinite(item.lat) && Number.isFinite(item.lon));
    const n = this.items.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const bright = new Float32Array(n);
    const live = new Float32Array(n);
    const sel = new Float32Array(n);
    const seeds = new Float32Array(n);
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    this.items.forEach((item, i) => {
      latLonToVector3(item.lat as number, item.lon as number, this.radius * 1.012, v);
      positions.set([v.x, v.y, v.z], i * 3);
      c.set(THEME_COLORS[item.category] ?? '#7fd4ff');
      colors.set([c.r, c.g, c.b], i * 3);
      bright[i] = ageBrightness(item, now);
      live[i] = isLive(item, now) ? 1 : 0;
      sel[i] = this.selectionOf(item.id);
      seeds[i] = ((i * 37) % 101) / 101;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    geometry.setAttribute('aLive', new THREE.BufferAttribute(live, 1));
    geometry.setAttribute('aSel', new THREE.BufferAttribute(sel, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 1.5);
    this.points.geometry.dispose();
    this.points.geometry = geometry;
  }

  private selectionOf(id: string): number {
    return id === this.selectedId ? 1 : id === this.hoveredId ? 0.5 : 0;
  }

  public setHighlight(selectedId: string | null, hoveredId: string | null): void {
    this.selectedId = selectedId;
    this.hoveredId = hoveredId;
    const attr = this.points.geometry.getAttribute('aSel') as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const arr = attr.array as Float32Array;
    this.items.forEach((item, i) => {
      arr[i] = this.selectionOf(item.id);
    });
    attr.needsUpdate = true;
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  public update(time: number, dpr: number): void {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uPixelRatio.value = dpr;
  }

  /** Point le plus proche du pointeur (≤ 10 px CSS), sur la face visible uniquement. */
  public hitTest(camera: THREE.Camera, pointer: THREE.Vector2, width: number, height: number): LiveItem | null {
    if (!this.group.visible || !this.items.length || width <= 0 || height <= 0) return null;
    camera.updateWorldMatrix(true, false);
    this.group.updateWorldMatrix(true, false);
    const point = new THREE.Vector3();
    const projected = new THREE.Vector3();
    const localCamera = this.group.worldToLocal(camera.getWorldPosition(new THREE.Vector3()));
    const toCamera = new THREE.Vector3();
    let closest = 10;
    let hit: LiveItem | null = null;
    for (const item of this.items) {
      latLonToVector3(item.lat as number, item.lon as number, this.radius * 1.012, point);
      if (toCamera.copy(localCamera).sub(point).dot(point) <= 0) continue;
      point.applyMatrix4(this.group.matrixWorld);
      projected.copy(point).project(camera);
      if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1) continue;
      const dist = Math.hypot(((projected.x - pointer.x) * width) / 2, ((projected.y - pointer.y) * height) / 2);
      if (dist < closest) {
        closest = dist;
        hit = item;
      }
    }
    return hit;
  }

  public dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
