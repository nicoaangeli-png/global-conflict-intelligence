import * as THREE from 'three';
import { latLonToVector3 } from '@/lib/geo/latlon';
import type { LiveItem } from '@/types/feeds';
import { ageBrightness } from '../feeds/feedModel';
import { trackPoints, vehicleHeading, vehicleOf, type VehicleKind } from '../feeds/vehicleModel';

/**
 * Mobiles militaires suivis sur le globe : aéronefs (ADS-B) et navires (AIS).
 *
 * - un seul `THREE.Points` pour tous les mobiles : chevron (aéronef) ou coque
 *   effilée (navire) orientés selon le cap publié, taille fixe à l'écran, liseré
 *   sombre pour rester lisibles sur les terres claires ; symbole non orienté
 *   (losange / rond) si aucun cap n'est connu ;
 * - un seul `THREE.LineSegments` pour tous les trajets observés : ligne fine
 *   qui s'estompe vers le passé, surlignée pour le mobile survolé ou choisi.
 *
 * Indépendant du rendu de la Terre et des thèmes : faces cachées éliminées dans
 * les shaders (comme `FeedLayer`), aucun test de profondeur.
 */

/** Couleurs de la palette militaire : olive (aéronefs), sable (navires). */
export const VEHICLE_COLORS: Record<VehicleKind, string> = { aircraft: '#c3d494', vessel: '#e6c88f' };

const AIRCRAFT_ALT = 1.011;
const VESSEL_ALT = 1.006;
const MAX_STEP_RAD = (1 * Math.PI) / 180;

const pointVertex = /* glsl */ `
  uniform float uPixelRatio;
  uniform vec2 uViewport;
  attribute vec3 aColor;
  attribute float aBright;
  attribute float aSel;
  attribute float aKind;
  attribute float aHeading;
  varying vec3 vColor;
  varying float vBright;
  varying float vSel;
  varying float vKind;
  varying float vOriented;
  varying float vAngle;
  varying float vFacing;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vFacing = dot(normalize(world.xyz), normalize(cameraPosition - world.xyz));
    vColor = aColor;
    vBright = aBright;
    vSel = aSel;
    vKind = aKind;
    vOriented = aHeading < -50.0 ? 0.0 : 1.0;
    gl_Position = projectionMatrix * viewMatrix * world;
    vAngle = 0.0;
    if (vOriented > 0.5) {
      // Cap géographique → angle écran : point décalé vers le cap dans le plan tangent local.
      vec3 n = normalize(position);
      vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), n) + vec3(1e-6, 0.0, 0.0));
      vec3 north = cross(n, east);
      vec3 dir = north * cos(aHeading) + east * sin(aHeading);
      vec4 ahead = projectionMatrix * viewMatrix * modelMatrix * vec4(position + dir * 0.02, 1.0);
      vec2 d = (ahead.xy / ahead.w - gl_Position.xy / gl_Position.w) * uViewport;
      vAngle = atan(d.y, d.x);
    }
    // Taille fixe à l'écran : navires ≈ 26 px (repérage en mer), avions ≈ 14 px.
    float size = aKind > 0.5 ? 29.0 : 17.5;
    gl_PointSize = (size + aSel * 6.0) * uPixelRatio;
  }
`;

const pointFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vBright;
  varying float vSel;
  varying float vKind;
  varying float vOriented;
  varying float vAngle;
  varying float vFacing;

  // Mesure signée approchée (> 0 à l'intérieur) dans le repère du symbole (+x = cap).
  float box(vec2 q, float x0, float x1, float hw) {
    return min(min(q.x - x0, x1 - q.x), hw - abs(q.y));
  }

  // Silhouette d'avion vue de dessus : fuselage, ailes en flèche, empennage.
  float plane(vec2 q) {
    float ay = abs(q.y);
    float fuselage = min(box(q, -0.78, 0.62, 0.1), 0.86 - q.x - ay * 2.4);
    float wing = min(min(0.18 - q.x - ay * 0.55, q.x + 0.12 + ay * 0.55), 0.82 - ay);
    float tail = min(min(-0.52 - q.x - ay * 0.35, q.x + 0.8 + ay * 0.1), 0.34 - ay);
    return max(max(fuselage, wing), tail);
  }

  // Mini bâtiment de guerre vu de dessus : étrave effilée (x = 0,95), poupe à tableau (x = -0,88),
  // plus grande largeur au tiers arrière.
  float hull(vec2 q) {
    float t = clamp((0.95 - q.x) / 1.0, 0.0, 1.0);
    float hw = q.x > -0.05 ? 0.25 * pow(t, 0.55) : 0.25 - (-0.05 - q.x) * 0.07;
    return min(min(hw - abs(q.y), q.x + 0.88), 0.95 - q.x);
  }

  // Détails de pont : superstructure centrale et deux tourelles (avant et arrière).
  float deck(vec2 q) {
    float sup = box(q, -0.38, 0.08, 0.115);
    float t1 = 0.075 - length(q - vec2(0.38, 0.0));
    float t2 = 0.065 - length(q - vec2(-0.6, 0.0));
    return max(sup, max(t1, t2));
  }

  void main() {
    if (vFacing < 0.04) discard;
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    vec2 p = vec2(uv.x, -uv.y);
    float c = cos(vAngle);
    float s = sin(vAngle);
    // Silhouette à 80 % du carré : la marge accueille liseré et halo sans coupure.
    vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y) * (vKind > 0.5 ? 1.12 : 1.25);
    float d;
    if (vKind < 0.5) d = vOriented > 0.5 ? plane(q) : 0.42 - (abs(q.x) + abs(q.y));
    else d = vOriented > 0.5 ? hull(q) : 0.34 - length(q);
    float body = smoothstep(0.0, 0.06, d);
    // Détails de pont du navire, plus sombres que la coque.
    float bridge = (vKind > 0.5 && vOriented > 0.5) ? smoothstep(0.0, 0.03, deck(q)) : 0.0;
    // Liseré sombre (lisibilité sur les terres) puis halo coloré léger (repérage).
    float outline = smoothstep(-0.12, 0.0, d) * (1.0 - body);
    float glow = smoothstep(-0.32, 0.0, d) * (1.0 - body) * (vKind > 0.5 ? 0.45 : 0.28);
    float ring = vSel > 0.0 ? smoothstep(0.08, 0.0, abs(length(uv) - 0.94)) * vSel : 0.0;
    float edge = smoothstep(0.04, 0.22, vFacing);
    float bright = 0.7 + 0.3 * vBright;
    vec3 fill = mix(mix(vColor, vec3(1.0), 0.15 + vSel * 0.3) * bright, vColor * 0.32, bridge * 0.8);
    vec3 dark = vec3(0.01, 0.03, 0.06);
    vec3 color = mix(mix(vColor, dark, outline > glow ? 0.85 : 0.0), fill, body);
    color = mix(color, vec3(1.0), ring * 0.7);
    float alpha = max(max(body, max(outline * 0.7, glow)), ring) * edge;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

const lineVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aAge;
  attribute float aSel;
  varying vec3 vColor;
  varying float vAge;
  varying float vSel;
  varying float vFacing;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vFacing = dot(normalize(world.xyz), normalize(cameraPosition - world.xyz));
    vColor = aColor;
    vAge = aAge;
    vSel = aSel;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const lineFragment = /* glsl */ `
  uniform float uDim;
  varying vec3 vColor;
  varying float vAge;
  varying float vSel;
  varying float vFacing;
  void main() {
    if (vFacing < 0.0) discard;
    float edge = smoothstep(0.0, 0.2, vFacing);
    // vAge : 0 = plus ancienne position, 1 = position actuelle → dégradé vers le passé.
    float base = (0.04 + 0.5 * vAge * vAge) * uDim;
    float alpha = mix(base, 0.2 + 0.8 * vAge, vSel) * edge;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), vSel * 0.35), alpha);
  }
`;

export class MobileLayer {
  public readonly group = new THREE.Group();
  private readonly points: THREE.Points;
  private readonly tracks: THREE.LineSegments;
  private readonly pointMaterial: THREE.ShaderMaterial;
  private readonly lineMaterial: THREE.ShaderMaterial;
  private items: LiveItem[] = [];
  private positions = new Float32Array(0);
  /** Pour chaque sommet de trajet : index de l'élément (surlignage). */
  private trackOwners = new Uint32Array(0);
  private selectedId: string | null = null;
  private hoveredId: string | null = null;

  constructor(private readonly radius: number) {
    this.pointMaterial = new THREE.ShaderMaterial({
      vertexShader: pointVertex,
      fragmentShader: pointFragment,
      uniforms: { uPixelRatio: { value: 1 }, uViewport: { value: new THREE.Vector2(1, 1) } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.lineMaterial = new THREE.ShaderMaterial({
      vertexShader: lineVertex,
      fragmentShader: lineFragment,
      uniforms: { uDim: { value: 1 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.pointMaterial);
    this.tracks = new THREE.LineSegments(new THREE.BufferGeometry(), this.lineMaterial);
    this.points.frustumCulled = false;
    this.tracks.frustumCulled = false;
    this.points.renderOrder = 26;
    this.tracks.renderOrder = 20;
    this.group.add(this.tracks, this.points);
  }

  private altitude(kind: VehicleKind | null): number {
    return this.radius * (kind === 'vessel' ? VESSEL_ALT : AIRCRAFT_ALT);
  }

  /** Remplace les mobiles affichés (positions + trajets), au rafraîchissement des flux. */
  public setItems(items: LiveItem[], now = Date.now()): void {
    this.items = items.filter((item) => vehicleOf(item) !== null && item.lat !== null && item.lon !== null && Number.isFinite(item.lat) && Number.isFinite(item.lon));
    const n = this.items.length;
    this.positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const bright = new Float32Array(n);
    const sel = new Float32Array(n);
    const kinds = new Float32Array(n);
    const headings = new Float32Array(n);
    const v = new THREE.Vector3();
    const c = new THREE.Color();

    const tPos: number[] = [];
    const tCol: number[] = [];
    const tAge: number[] = [];
    const tOwner: number[] = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const prev = new THREE.Vector3();
    const cur = new THREE.Vector3();

    this.items.forEach((item, i) => {
      const kind = vehicleOf(item);
      const r = this.altitude(kind);
      latLonToVector3(item.lat as number, item.lon as number, r, v);
      this.positions.set([v.x, v.y, v.z], i * 3);
      c.set(VEHICLE_COLORS[kind ?? 'aircraft']);
      colors.set([c.r, c.g, c.b], i * 3);
      bright[i] = ageBrightness(item, now);
      sel[i] = this.selectionOf(item.id);
      kinds[i] = kind === 'vessel' ? 1 : 0;
      const heading = vehicleHeading(item);
      headings[i] = heading ? (heading.deg * Math.PI) / 180 : -100;

      // Trajet : segments en grand cercle entre positions observées successives.
      const pts = trackPoints(item);
      if (pts.length < 2) return;
      const t0 = pts[0].t;
      const span = Math.max(1, pts[pts.length - 1].t - t0);
      for (let k = 0; k < pts.length - 1; k++) {
        latLonToVector3(pts[k].lat, pts[k].lon, 1, a);
        latLonToVector3(pts[k + 1].lat, pts[k + 1].lon, 1, b);
        const angle = a.angleTo(b);
        if (!Number.isFinite(angle) || angle < 1e-7) continue;
        const steps = Math.max(1, Math.ceil(angle / MAX_STEP_RAD));
        const ageA = (pts[k].t - t0) / span;
        const ageB = (pts[k + 1].t - t0) / span;
        prev.copy(a).multiplyScalar(r);
        let prevAge = ageA;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const sinA = Math.sin(angle);
          const wa = Math.sin((1 - t) * angle) / sinA;
          const wb = Math.sin(t * angle) / sinA;
          cur.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb).multiplyScalar(r);
          const age = ageA + (ageB - ageA) * t;
          tPos.push(prev.x, prev.y, prev.z, cur.x, cur.y, cur.z);
          tCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
          tAge.push(prevAge, age);
          tOwner.push(i, i);
          prev.copy(cur);
          prevAge = age;
        }
      }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    geometry.setAttribute('aSel', new THREE.BufferAttribute(sel, 1));
    geometry.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
    geometry.setAttribute('aHeading', new THREE.BufferAttribute(headings, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 1.5);
    this.points.geometry.dispose();
    this.points.geometry = geometry;

    this.trackOwners = Uint32Array.from(tOwner);
    const trackSel = new Float32Array(tOwner.length);
    tOwner.forEach((owner, k) => (trackSel[k] = this.selectionOf(this.items[owner].id) > 0 ? 1 : 0));
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tPos), 3));
    lines.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(tCol), 3));
    lines.setAttribute('aAge', new THREE.BufferAttribute(new Float32Array(tAge), 1));
    lines.setAttribute('aSel', new THREE.BufferAttribute(trackSel, 1));
    lines.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.radius * 1.5);
    this.tracks.geometry.dispose();
    this.tracks.geometry = lines;
  }

  private selectionOf(id: string): number {
    return id === this.selectedId ? 1 : id === this.hoveredId ? 0.6 : 0;
  }

  /** Surligne le mobile (et son trajet) choisi ou survolé ; atténue les autres trajets. */
  public setHighlight(selectedId: string | null, hoveredId: string | null): void {
    this.selectedId = selectedId;
    this.hoveredId = hoveredId;
    const attr = this.points.geometry.getAttribute('aSel') as THREE.BufferAttribute | undefined;
    if (attr) {
      const arr = attr.array as Float32Array;
      this.items.forEach((item, i) => (arr[i] = this.selectionOf(item.id)));
      attr.needsUpdate = true;
    }
    const tAttr = this.tracks.geometry.getAttribute('aSel') as THREE.BufferAttribute | undefined;
    let any = false;
    if (tAttr) {
      const arr = tAttr.array as Float32Array;
      for (let k = 0; k < this.trackOwners.length; k++) {
        arr[k] = this.selectionOf(this.items[this.trackOwners[k]].id) > 0 ? 1 : 0;
        any ||= arr[k] > 0;
      }
      tAttr.needsUpdate = true;
    }
    this.lineMaterial.uniforms.uDim.value = any ? 0.45 : 1;
  }

  public update(dpr: number, width: number, height: number): void {
    this.pointMaterial.uniforms.uPixelRatio.value = dpr;
    (this.pointMaterial.uniforms.uViewport.value as THREE.Vector2).set(width, height);
  }

  /** Mobile le plus proche du pointeur (≤ 11 px CSS), face visible uniquement. */
  public hitTest(camera: THREE.Camera, pointer: THREE.Vector2, width: number, height: number): LiveItem | null {
    if (!this.group.visible || !this.items.length || width <= 0 || height <= 0) return null;
    camera.updateWorldMatrix(true, false);
    this.group.updateWorldMatrix(true, false);
    const localCamera = this.group.worldToLocal(camera.getWorldPosition(new THREE.Vector3()));
    const point = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    let closest = 11;
    let hit: LiveItem | null = null;
    for (let i = 0; i < this.items.length; i++) {
      point.fromArray(this.positions, i * 3);
      if (toCamera.copy(localCamera).sub(point).dot(point) <= 0) continue;
      point.applyMatrix4(this.group.matrixWorld).project(camera);
      if (Math.abs(point.x) > 1 || Math.abs(point.y) > 1 || Math.abs(point.z) > 1) continue;
      const dist = Math.hypot(((point.x - pointer.x) * width) / 2, ((point.y - pointer.y) * height) / 2);
      if (dist < closest) {
        closest = dist;
        hit = this.items[i];
      }
    }
    return hit;
  }

  public dispose(): void {
    this.points.geometry.dispose();
    this.tracks.geometry.dispose();
    this.pointMaterial.dispose();
    this.lineMaterial.dispose();
  }
}
