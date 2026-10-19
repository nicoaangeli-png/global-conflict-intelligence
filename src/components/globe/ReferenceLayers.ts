import * as THREE from 'three';
import { latLonToVector3 } from '@/lib/geo/latlon';
import type { WorldIndex } from '@/lib/geo/world';
import type { LayerFeature, LayerId } from '@/types/layers';
import { LAYER_STYLE, featurePoint, lineParts } from '../layers/layerModel';

/**
 * Calques de référence du globe (infrastructures stables, hors flux en direct).
 *
 * - installations (centrales, bases) : un seul `THREE.Points` par calque, quel que
 *   soit le nombre d'éléments (plusieurs milliers possibles), forme dessinée dans
 *   le shader (anneau fin / petit carré) — aucune icône ;
 * - câbles sous-marins : un seul `THREE.LineSegments` (lignes fines lumineuses,
 *   tracés subdivisés en grand cercle pour épouser la sphère) ;
 * - sanctions : aucun point, une teinte légère des pays concernés (texture
 *   équirectangulaire dessinée une fois sur un canevas, coque transparente).
 *
 * Rien ne touche au rendu de la Terre : tout est posé au-dessus de la sphère,
 * faces cachées éliminées dans les shaders comme pour `FeedLayer`.
 */

const pointVertex = /* glsl */ `
  uniform float uPixelRatio;
  uniform float uSize;
  attribute float aSel;
  varying float vSel;
  varying float vFacing;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vFacing = dot(normalize(world.xyz), normalize(cameraPosition - world.xyz));
    vSel = aSel;
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_PointSize = (uSize + aSel * 6.0) * uPixelRatio;
  }
`;

const pointFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uShape;
  uniform float uOpacity;
  varying float vSel;
  varying float vFacing;
  void main() {
    if (vFacing < 0.04) discard;
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float shape;
    if (uShape < 0.5) {
      // Anneau fin (centrale nucléaire).
      float r = length(uv);
      shape = smoothstep(0.26, 0.0, abs(r - 0.66));
    } else {
      // Petit carré plein (base militaire).
      float m = max(abs(uv.x), abs(uv.y));
      shape = smoothstep(0.62, 0.46, m);
    }
    float outline = vSel > 0.0 ? smoothstep(0.14, 0.0, abs(length(uv) - 0.93)) * vSel : 0.0;
    float edge = smoothstep(0.04, 0.22, vFacing);
    float alpha = (shape * uOpacity + outline) * edge;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), outline * 0.6 + vSel * 0.2), min(alpha, 1.0));
  }
`;

const lineVertex = /* glsl */ `
  varying float vFacing;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vFacing = dot(normalize(world.xyz), normalize(cameraPosition - world.xyz));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const lineFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFacing;
  void main() {
    if (vFacing < 0.0) discard;
    float edge = smoothstep(0.0, 0.25, vFacing);
    gl_FragColor = vec4(uColor, uOpacity * edge);
  }
`;

const ALTITUDE = 1.008; // installations : juste sous les points de flux (1,012)
const CABLE_ALTITUDE = 1.0035;
const MAX_STEP_RAD = (1.5 * Math.PI) / 180; // subdivision des tracés de câbles

type Hit = { layerId: LayerId; feature: LayerFeature };

/** Distance écran (px) d'un point à un segment. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Installations ponctuelles d'un calque : un seul `THREE.Points`. */
class PointLayer {
  public readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private features: LayerFeature[] = [];
  private positions = new Float32Array(0);
  private selectedId: string | null = null;
  private hoveredId: string | null = null;

  constructor(
    private readonly layerId: LayerId,
    private readonly radius: number,
    shape: 'ring' | 'square',
  ) {
    const style = LAYER_STYLE[layerId];
    this.material = new THREE.ShaderMaterial({
      vertexShader: pointVertex,
      fragmentShader: pointFragment,
      uniforms: {
        uColor: { value: new THREE.Color(style.color) },
        uShape: { value: shape === 'ring' ? 0 : 1 },
        uSize: { value: shape === 'ring' ? 8 : 5 },
        uOpacity: { value: shape === 'ring' ? 0.9 : 0.7 },
        uPixelRatio: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 18;
    this.points.visible = false;
  }

  public setFeatures(features: LayerFeature[]): void {
    this.features = features.filter((f) => featurePoint(f) !== null);
    const n = this.features.length;
    this.positions = new Float32Array(n * 3);
    const sel = new Float32Array(n);
    const v = new THREE.Vector3();
    this.features.forEach((f, i) => {
      const p = featurePoint(f)!;
      latLonToVector3(p.lat, p.lon, this.radius * ALTITUDE, v);
      this.positions.set([v.x, v.y, v.z], i * 3);
      sel[i] = this.selectionOf(f.id);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aSel', new THREE.BufferAttribute(sel, 1));
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
    this.features.forEach((f, i) => (arr[i] = this.selectionOf(f.id)));
    attr.needsUpdate = true;
  }

  public update(dpr: number): void {
    this.material.uniforms.uPixelRatio.value = dpr;
  }

  /** Élément le plus proche du pointeur (≤ 8 px), face visible uniquement. */
  public hitTest(camera: THREE.Camera, pointer: THREE.Vector2, width: number, height: number, matrixWorld: THREE.Matrix4, localCamera: THREE.Vector3): { hit: Hit; dist: number } | null {
    if (!this.points.visible || !this.features.length) return null;
    const point = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    let closest = 8;
    let hit: LayerFeature | null = null;
    for (let i = 0; i < this.features.length; i++) {
      point.fromArray(this.positions, i * 3);
      if (toCamera.copy(localCamera).sub(point).dot(point) <= 0) continue;
      point.applyMatrix4(matrixWorld).project(camera);
      if (Math.abs(point.x) > 1 || Math.abs(point.y) > 1 || Math.abs(point.z) > 1) continue;
      const dist = Math.hypot(((point.x - pointer.x) * width) / 2, ((point.y - pointer.y) * height) / 2);
      if (dist < closest) {
        closest = dist;
        hit = this.features[i];
      }
    }
    return hit ? { hit: { layerId: this.layerId, feature: hit }, dist: closest } : null;
  }

  public dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/** Câbles sous-marins : tous les tracés dans un seul `LineSegments`, + surlignage du câble choisi. */
class CableLayer {
  public readonly group = new THREE.Group();
  private readonly lines: THREE.LineSegments;
  private readonly highlight: THREE.LineSegments;
  private readonly material: THREE.ShaderMaterial;
  private readonly highlightMaterial: THREE.ShaderMaterial;
  private features: LayerFeature[] = [];
  private positions = new Float32Array(0);
  /** Élément propriétaire de chaque segment (index dans `features`). */
  private owners = new Uint32Array(0);
  private selectedId: string | null = null;

  constructor(private readonly radius: number) {
    const color = new THREE.Color(LAYER_STYLE.submarine_cables.color);
    const make = (opacity: number) =>
      new THREE.ShaderMaterial({
        vertexShader: lineVertex,
        fragmentShader: lineFragment,
        uniforms: { uColor: { value: color.clone() }, uOpacity: { value: opacity } },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });
    this.material = make(0.32);
    this.highlightMaterial = make(0.95);
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), this.material);
    this.highlight = new THREE.LineSegments(new THREE.BufferGeometry(), this.highlightMaterial);
    for (const obj of [this.lines, this.highlight]) {
      obj.frustumCulled = false;
      obj.renderOrder = 16;
      this.group.add(obj);
    }
    this.group.visible = false;
  }

  /** Segments 3D d'un élément, subdivisés en grand cercle (≤ 1,5° par pas). */
  private segmentsOf(feature: LayerFeature, out: number[]): number {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const prev = new THREE.Vector3();
    const cur = new THREE.Vector3();
    const r = this.radius * CABLE_ALTITUDE;
    let count = 0;
    for (const part of lineParts(feature)) {
      for (let i = 0; i < part.length - 1; i++) {
        latLonToVector3(part[i][1], part[i][0], 1, a);
        latLonToVector3(part[i + 1][1], part[i + 1][0], 1, b);
        const angle = a.angleTo(b);
        if (!Number.isFinite(angle) || angle === 0) continue;
        const steps = Math.max(1, Math.ceil(angle / MAX_STEP_RAD));
        prev.copy(a).multiplyScalar(r);
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          // Interpolation sphérique (slerp) entre deux points unitaires.
          const sinA = Math.sin(angle);
          const wa = Math.sin((1 - t) * angle) / sinA;
          const wb = Math.sin(t * angle) / sinA;
          cur.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb).multiplyScalar(r);
          out.push(prev.x, prev.y, prev.z, cur.x, cur.y, cur.z);
          prev.copy(cur);
          count++;
        }
      }
    }
    return count;
  }

  public setFeatures(features: LayerFeature[]): void {
    this.features = features;
    const coords: number[] = [];
    const owners: number[] = [];
    features.forEach((f, index) => {
      const n = this.segmentsOf(f, coords);
      for (let k = 0; k < n; k++) owners.push(index);
    });
    this.positions = new Float32Array(coords);
    this.owners = Uint32Array.from(owners);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 1.5);
    this.lines.geometry.dispose();
    this.lines.geometry = geometry;
    this.setSelected(this.selectedId);
  }

  public setSelected(id: string | null): void {
    this.selectedId = id;
    const feature = id ? this.features.find((f) => f.id === id) : null;
    const coords: number[] = [];
    if (feature) this.segmentsOf(feature, coords);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(coords), 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 1.5);
    this.highlight.geometry.dispose();
    this.highlight.geometry = geometry;
  }

  /** Câble le plus proche du pointeur (≤ 5 px), segments de la face visible uniquement. */
  public hitTest(camera: THREE.Camera, pointer: THREE.Vector2, width: number, height: number, matrixWorld: THREE.Matrix4, localCamera: THREE.Vector3): { hit: Hit; dist: number } | null {
    if (!this.group.visible || !this.owners.length) return null;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    const px = (pointer.x * width) / 2;
    const py = (pointer.y * height) / 2;
    let closest = 5;
    let owner = -1;
    for (let i = 0; i < this.owners.length; i++) {
      a.fromArray(this.positions, i * 6);
      if (toCamera.copy(localCamera).sub(a).dot(a) <= 0) continue;
      b.fromArray(this.positions, i * 6 + 3);
      a.applyMatrix4(matrixWorld).project(camera);
      b.applyMatrix4(matrixWorld).project(camera);
      if (Math.abs(a.z) > 1 || Math.abs(b.z) > 1) continue;
      const dist = segmentDistance(px, py, (a.x * width) / 2, (a.y * height) / 2, (b.x * width) / 2, (b.y * height) / 2);
      if (dist < closest) {
        closest = dist;
        owner = this.owners[i];
      }
    }
    return owner >= 0 ? { hit: { layerId: 'submarine_cables', feature: this.features[owner] }, dist: closest } : null;
  }

  public dispose(): void {
    this.lines.geometry.dispose();
    this.highlight.geometry.dispose();
    this.material.dispose();
    this.highlightMaterial.dispose();
  }
}

/** Teinte légère des pays visés par des sanctions : texture équirectangulaire sur une coque. */
class TintLayer {
  public readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(radius: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2048;
    this.canvas.height = 1024;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, depthTest: true, toneMapped: false });
    // UV de SphereGeometry alignés sur latLonToVector3 (u = (lon + 180) / 360).
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.0016, 128, 64), this.material);
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
  }

  /** Redessine la teinte pour les pays donnés (ISO3), uniforme : ce n'est pas une échelle de risque. */
  public setCountries(isos: Set<string>, world: WorldIndex | null, color: string): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (world && isos.size) {
      const c = new THREE.Color(color);
      const rgb = `${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}`;
      // Très léger : ~145 pays concernés, le globe doit rester holographique.
      ctx.fillStyle = `rgba(${rgb}, 0.05)`;
      ctx.strokeStyle = `rgba(${rgb}, 0.26)`;
      ctx.lineWidth = 1;
      for (const iso of isos) {
        const country = world.byIso.get(iso);
        if (!country) continue;
        ctx.beginPath();
        for (const polygon of country.polygons) {
          for (const ring of polygon) {
            ring.forEach(([lon, lat], i) => {
              const x = ((lon + 180) / 360) * W;
              const y = ((90 - lat) / 180) * H;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            ctx.closePath();
          }
        }
        // Règle pair-impair : les trous (enclaves) restent non teintés.
        ctx.fill('evenodd');
        ctx.stroke();
      }
    }
    this.texture.needsUpdate = true;
  }

  public dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

export class ReferenceLayers {
  public readonly group = new THREE.Group();
  private readonly nuclear: PointLayer;
  private readonly bases: PointLayer;
  private readonly cables: CableLayer;
  private readonly tint: TintLayer;

  constructor(radius: number) {
    this.nuclear = new PointLayer('nuclear_plants', radius, 'ring');
    this.bases = new PointLayer('military_bases', radius, 'square');
    this.cables = new CableLayer(radius);
    this.tint = new TintLayer(radius);
    this.group.add(this.tint.mesh, this.cables.group, this.bases.points, this.nuclear.points);
  }

  /** Données d'un calque ; `null` = pas (encore) de données. */
  public setFeatures(id: LayerId, features: LayerFeature[] | null): void {
    if (id === 'nuclear_plants') this.nuclear.setFeatures(features ?? []);
    else if (id === 'military_bases') this.bases.setFeatures(features ?? []);
    else if (id === 'submarine_cables') this.cables.setFeatures(features ?? []);
  }

  public setSanctions(isos: Set<string>, world: WorldIndex | null): void {
    this.tint.setCountries(isos, world, LAYER_STYLE.sanctions.color);
  }

  public setVisible(id: LayerId, visible: boolean): void {
    if (id === 'nuclear_plants') this.nuclear.points.visible = visible;
    else if (id === 'military_bases') this.bases.points.visible = visible;
    else if (id === 'submarine_cables') this.cables.group.visible = visible;
    else this.tint.mesh.visible = visible;
  }

  public setHighlight(selected: { layerId: LayerId; id: string } | null, hovered: { layerId: LayerId; id: string } | null): void {
    const pick = (layerId: LayerId, s: typeof selected) => (s && s.layerId === layerId ? s.id : null);
    this.nuclear.setHighlight(pick('nuclear_plants', selected), pick('nuclear_plants', hovered));
    this.bases.setHighlight(pick('military_bases', selected), pick('military_bases', hovered));
    this.cables.setSelected(pick('submarine_cables', selected) ?? pick('submarine_cables', hovered));
  }

  public update(dpr: number): void {
    this.nuclear.update(dpr);
    this.bases.update(dpr);
  }

  /**
   * Élément sous le pointeur : installations d'abord (cible précise), puis câbles
   * si `withLines` (test plus coûteux, réservé au clic et au survol ralenti).
   */
  public hitTest(camera: THREE.Camera, pointer: THREE.Vector2, width: number, height: number, withLines: boolean): Hit | null {
    if (width <= 0 || height <= 0) return null;
    camera.updateWorldMatrix(true, false);
    this.group.updateWorldMatrix(true, false);
    const localCamera = this.group.worldToLocal(camera.getWorldPosition(new THREE.Vector3()));
    const m = this.group.matrixWorld;
    const candidates = [this.nuclear.hitTest(camera, pointer, width, height, m, localCamera), this.bases.hitTest(camera, pointer, width, height, m, localCamera)].filter(
      (c): c is { hit: Hit; dist: number } => c !== null,
    );
    if (candidates.length) return candidates.sort((a, b) => a.dist - b.dist)[0].hit;
    return withLines ? (this.cables.hitTest(camera, pointer, width, height, m, localCamera)?.hit ?? null) : null;
  }

  public dispose(): void {
    this.nuclear.dispose();
    this.bases.dispose();
    this.cables.dispose();
    this.tint.dispose();
  }
}
