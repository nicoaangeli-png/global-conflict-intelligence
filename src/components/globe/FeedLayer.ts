import * as THREE from 'three';
import { latLonToVector3 } from '@/lib/geo/latlon';
import type { LiveItem } from '@/types/feeds';
import { THEME_COLORS, ageBrightness, isLive, itemHeading } from '../feeds/feedModel';

/**
 * Calque des flux mondiaux géolocalisés (séismes, cyclones, manifestations,
 * lancements…) : un point par élément, couleur de sa catégorie, halo pulsant
 * s'il date de moins de 2 h, éclat décroissant avec l'âge.
 *
 * Aéronefs militaires (positions ADS-B) : petit chevron orienté selon le cap
 * publié par la source (losange discret si le cap manque), sans halo — une
 * position est par nature « en direct », un halo sur chacune saturerait le globe.
 *
 * Indépendant du rendu de la Terre : un seul `THREE.Points` posé au-dessus de
 * la sphère, faces cachées éliminées dans le shader (aucun test de profondeur).
 */

const vertex = /* glsl */ `
  uniform float uPixelRatio;
  uniform vec2 uViewport;
  attribute vec3 aColor;
  attribute float aBright;
  attribute float aLive;
  attribute float aSel;
  attribute float aSeed;
  attribute float aShape;
  attribute float aHeading;
  varying vec3 vColor;
  varying float vBright;
  varying float vLive;
  varying float vSel;
  varying float vFacing;
  varying float vSeed;
  varying float vShape;
  varying float vAngle;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vFacing = dot(normalize(world.xyz), normalize(cameraPosition - world.xyz));
    vColor = aColor;
    vBright = aBright;
    vLive = aLive;
    vSel = aSel;
    vSeed = aSeed;
    vShape = aShape;
    vAngle = 0.0;
    gl_Position = projectionMatrix * viewMatrix * world;
    if (aShape > 0.5) {
      // Cap géographique → angle à l'écran : on projette un point décalé vers le cap
      // dans le plan tangent (nord/est locaux) et on mesure la direction écran.
      vec3 n = normalize(position);
      vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), n) + vec3(1e-6, 0.0, 0.0));
      vec3 north = cross(n, east);
      vec3 dir = north * cos(aHeading) + east * sin(aHeading);
      vec4 ahead = projectionMatrix * viewMatrix * modelMatrix * vec4(position + dir * 0.02, 1.0);
      vec2 a = gl_Position.xy / gl_Position.w;
      vec2 b = ahead.xy / ahead.w;
      vec2 d = (b - a) * uViewport;
      vAngle = atan(d.y, d.x);
      gl_PointSize = (10.0 + aSel * 5.0) * uPixelRatio;
    } else {
      float core = 7.0 + aSel * 5.0;
      // Un point « en direct » réserve la place de son halo (3,2 × le cœur).
      gl_PointSize = (aLive > 0.5 ? core * 3.2 : core) * uPixelRatio;
    }
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
  varying float vShape;
  varying float vAngle;
  void main() {
    if (vFacing < 0.04) discard;
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    if (vShape > 0.5) {
      float edge = smoothstep(0.04, 0.22, vFacing);
      // Repère du chevron : +x = cap (gl_PointCoord a l'axe y vers le bas).
      vec2 p = vec2(uv.x, -uv.y);
      float c = cos(vAngle);
      float s = sin(vAngle);
      vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
      float shape;
      if (vShape > 1.5) {
        // Cap non publié : petit losange, sans orientation inventée.
        shape = smoothstep(0.62, 0.48, abs(q.x) + abs(q.y));
      } else {
        float ay = abs(q.y);
        // Chevron effilé : pointe en x = 0,9, ailes en x = -0,7, encoche arrière.
        float inside = min(min(0.9 - q.x - ay * 2.3, q.x + 0.72), q.x + 0.35 + ay * 0.58);
        shape = smoothstep(0.0, 0.14, inside) * step(q.x, 0.9);
      }
      float outline = vSel > 0.0 ? smoothstep(0.12, 0.0, abs(length(uv) - 0.92)) * vSel : 0.0;
      float alpha = (shape * (0.55 + 0.45 * vBright) + outline) * edge;
      if (alpha < 0.01) discard;
      vec3 color = mix(vColor, vec3(1.0), shape * 0.18 + outline * 0.6 + vSel * 0.25);
      gl_FragColor = vec4(color, min(alpha, 1.0));
      return;
    }
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
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uViewport: { value: new THREE.Vector2(1, 1) } },
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
    const shapes = new Float32Array(n);
    const headings = new Float32Array(n);
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    this.items.forEach((item, i) => {
      latLonToVector3(item.lat as number, item.lon as number, this.radius * 1.012, v);
      positions.set([v.x, v.y, v.z], i * 3);
      c.set(THEME_COLORS[item.category] ?? '#7fd4ff');
      colors.set([c.r, c.g, c.b], i * 3);
      bright[i] = ageBrightness(item, now);
      if (item.category === 'military') {
        const heading = itemHeading(item);
        shapes[i] = heading === null ? 2 : 1;
        headings[i] = heading === null ? 0 : (heading * Math.PI) / 180;
        live[i] = 0;
      } else {
        live[i] = isLive(item, now) ? 1 : 0;
      }
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
    geometry.setAttribute('aShape', new THREE.BufferAttribute(shapes, 1));
    geometry.setAttribute('aHeading', new THREE.BufferAttribute(headings, 1));
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

  public update(time: number, dpr: number, width = 1, height = 1): void {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uPixelRatio.value = dpr;
    (this.material.uniforms.uViewport.value as THREE.Vector2).set(width, height);
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
