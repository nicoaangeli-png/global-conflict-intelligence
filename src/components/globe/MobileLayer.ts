import * as THREE from 'three';
import { latLonToVector3 } from '@/lib/geo/latlon';
import type { LiveItem } from '@/types/feeds';
import { ageBrightness } from '../feeds/feedModel';
import { trackPoints, vehicleHeading, vehicleOf, type VehicleKind } from '../feeds/vehicleModel';

/**
 * Mobiles militaires suivis sur le globe : aéronefs (ADS-B) et navires (AIS).
 *
 * - un seul `THREE.Points` pour tous les mobiles : silhouette d'avion (aéronef) ou
 *   orientée selon le cap publié (aéronef) ; navire vu de profil, tourné vers la
 *   gauche ou la droite selon son cap à l'écran (bâtiment de guerre ou cargo),
 *   plus lisible qu'une coque vue de dessus à cette taille. Taille fixe à l'écran,
 *   liseré sombre pour rester lisibles sur les terres claires ; losange pour un
 *   aéronef sans cap connu.
 *   Avions dessinés en dernier : jamais masqués par un navire ;
 * - un seul `THREE.LineSegments` pour tous les trajets observés : ligne fine
 *   qui s'estompe vers le passé, surlignée pour le mobile survolé ou choisi.
 *
 * Indépendant du rendu de la Terre et des thèmes : faces cachées éliminées dans
 * les shaders (comme `FeedLayer`), aucun test de profondeur.
 */

/**
 * Couleurs franches, absentes de la palette des événements (rouges/oranges/blancs) :
 * vert fluo (aéronefs), bleu vif (navires militaires), gris-bleu discret (navires civils).
 */
export const VEHICLE_COLORS: Record<VehicleKind, string> = { aircraft: '#b6ff3b', vessel: '#2fb8ff', merchant: '#7f93a8' };

const AIRCRAFT_ALT = 1.011;
const VESSEL_ALT = 1.006;
const MAX_STEP_RAD = (1 * Math.PI) / 180;
/**
 * Glissement entre deux positions OBSERVÉES successives, étalé sur l'intervalle de
 * rafraîchissement : le symbole avance en continu sans jamais dépasser la dernière
 * position publiée (aucune extrapolation). Au-delà de ~3°, saut direct.
 */
export const MOBILE_GLIDE_MS = 15_000;
const MAX_GLIDE_RAD = (3 * Math.PI) / 180;

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
    // Taille fixe à l'écran (px CSS) : avions 22, navires militaires 18, navires civils 13.
    float size = aKind > 1.5 ? 13.0 : aKind > 0.5 ? 18.0 : 22.0;
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

  float rect(vec2 q, float x0, float x1, float y0, float y1) {
    return min(min(q.x - x0, x1 - q.x), min(q.y - y0, y1 - q.y));
  }

  // Coque vue de profil, proue à droite : pont en y1, quille en y0, étrave inclinée.
  float hullSide(vec2 q, float y0, float y1, float stern, float bow) {
    float depth = y1 - q.y;
    return min(min(q.y - y0, depth), min(q.x - stern - depth * 0.35, bow - depth * 0.9 - q.x));
  }

  // Bâtiment de guerre de profil : coque basse, passerelle en gradins, mât, tourelle avant.
  float warship(vec2 q) {
    float hull = hullSide(q, -0.42, -0.08, -0.92, 0.98);
    float bridge = max(rect(q, -0.5, 0.18, -0.1, 0.16), rect(q, -0.32, 0.04, 0.1, 0.34));
    float mast = rect(q, -0.2, -0.1, 0.3, 0.62);
    float turret = rect(q, 0.32, 0.56, -0.1, 0.06);
    return max(max(hull, bridge), max(mast, turret));
  }

  // Cargo de profil : coque, conteneurs au centre, passerelle haute à l'arrière.
  float cargo(vec2 q) {
    float hull = hullSide(q, -0.42, -0.06, -0.9, 0.96);
    float boxes = rect(q, -0.4, 0.62, -0.08, 0.2);
    float bridge = rect(q, -0.8, -0.5, -0.08, 0.46);
    return max(hull, max(boxes, bridge));
  }

  void main() {
    if (vFacing < 0.04) discard;
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    vec2 p = vec2(uv.x, -uv.y);
    float c = cos(vAngle);
    float s = sin(vAngle);
    // Silhouette à 80 % du carré : la marge accueille liseré et halo sans coupure.
    vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y) * 1.2;
    // Navire : profil non tourné, proue vers la gauche si le cap pointe vers la gauche de l'écran.
    if (vKind > 0.5) q = vec2(vOriented > 0.5 && c < 0.0 ? -p.x : p.x, p.y) * 1.05;
    float d;
    if (vKind < 0.5) d = vOriented > 0.5 ? plane(q) : 0.42 - (abs(q.x) + abs(q.y));
    else d = vKind > 1.5 ? cargo(q) : warship(q);
    float body = smoothstep(0.0, 0.06, d);
    // Liseré sombre (lisibilité sur les terres) puis halo coloré léger (repérage).
    float outline = smoothstep(-0.12, 0.0, d) * (1.0 - body);
    float glow = smoothstep(-0.32, 0.0, d) * (1.0 - body) * (vKind > 1.5 ? 0.0 : vKind > 0.5 ? 0.25 : 0.4);
    float ring = vSel > 0.0 ? smoothstep(0.08, 0.0, abs(length(uv) - 0.94)) * vSel : 0.0;
    float edge = smoothstep(0.04, 0.22, vFacing);
    float bright = 0.75 + 0.25 * vBright;
    vec3 fill = mix(vColor, vec3(1.0), 0.1 + vSel * 0.3) * bright;
    vec3 dark = vec3(0.01, 0.03, 0.06);
    vec3 color = mix(mix(vColor, dark, outline > glow ? 0.85 : 0.0), fill, body);
    color = mix(color, vec3(1.0), ring * 0.7);
    float alpha = max(max(body, max(outline * 0.7, glow)), ring) * edge * (vKind > 1.5 ? 0.8 : 1.0);
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
  uniform float uTime;
  varying vec3 vColor;
  varying float vAge;
  varying float vSel;
  varying float vFacing;
  void main() {
    if (vFacing < 0.0) discard;
    float edge = smoothstep(0.0, 0.2, vFacing);
    // vAge : 0 = plus ancienne position, 1 = position actuelle → dégradé vers le passé.
    float base = (0.1 + 0.6 * vAge * vAge) * uDim;
    // Impulsions qui remontent le trajet vers la position actuelle : sens du déplacement.
    float pulse = smoothstep(0.75, 1.0, fract(vAge * 3.0 - uTime * 0.35)) * (0.25 + 0.75 * vAge) * uDim;
    float alpha = mix(base + pulse * 0.7, 0.2 + 0.8 * vAge, vSel) * edge;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), max(vSel * 0.35, pulse * 0.5)), alpha);
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
  /** Position affichée de chaque mobile (point de départ du glissement suivant). */
  private shown = new Map<string, THREE.Vector3>();
  private glideFrom = new Float32Array(0);
  private glideTo = new Float32Array(0);
  private glideStart = 0;
  private gliding = false;

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
      uniforms: { uDim: { value: 1 }, uTime: { value: 0 } },
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
    return this.radius * (kind === 'vessel' || kind === 'merchant' ? VESSEL_ALT : AIRCRAFT_ALT);
  }

  /** Remplace les mobiles affichés (positions + trajets), au rafraîchissement des flux. */
  public setItems(items: LiveItem[], now = Date.now()): void {
    const drawOrder: Record<VehicleKind, number> = { merchant: 0, vessel: 1, aircraft: 2 };
    this.items = items
      .filter((item) => vehicleOf(item) !== null && item.lat !== null && item.lon !== null && Number.isFinite(item.lat) && Number.isFinite(item.lon))
      .sort((a, b) => drawOrder[vehicleOf(a)!] - drawOrder[vehicleOf(b)!]);
    const n = this.items.length;
    this.positions = new Float32Array(n * 3);
    this.glideFrom = new Float32Array(n * 3);
    this.glideTo = new Float32Array(n * 3);
    const shown = new Map<string, THREE.Vector3>();
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
      this.glideTo.set([v.x, v.y, v.z], i * 3);
      const from = this.shown.get(item.id);
      const start = from && from.angleTo(v) <= MAX_GLIDE_RAD ? from.clone().setLength(r) : v.clone();
      this.glideFrom.set([start.x, start.y, start.z], i * 3);
      this.positions.set([start.x, start.y, start.z], i * 3);
      shown.set(item.id, start);
      c.set(VEHICLE_COLORS[kind ?? 'aircraft']);
      colors.set([c.r, c.g, c.b], i * 3);
      bright[i] = ageBrightness(item, now);
      sel[i] = this.selectionOf(item.id);
      kinds[i] = kind === 'merchant' ? 2 : kind === 'vessel' ? 1 : 0;
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
    this.shown = shown;
    this.glideStart = performance.now();
    this.gliding = n > 0;

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

  public update(dpr: number, width: number, height: number, now = performance.now()): void {
    this.pointMaterial.uniforms.uPixelRatio.value = dpr;
    (this.pointMaterial.uniforms.uViewport.value as THREE.Vector2).set(width, height);
    this.lineMaterial.uniforms.uTime.value = now / 1000;
    if (this.gliding) this.glide(now);
  }

  /** Avance chaque symbole sur l'arc entre sa position affichée et la dernière observée. */
  private glide(now: number): void {
    const t = Math.min(1, Math.max(0, (now - this.glideStart) / MOBILE_GLIDE_MS));
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = 0; i < this.items.length; i++) {
      a.fromArray(this.glideFrom, i * 3);
      b.fromArray(this.glideTo, i * 3);
      const r = b.length();
      a.lerp(b, t).setLength(r);
      a.toArray(this.positions, i * 3);
      this.shown.get(this.items[i].id)?.copy(a);
    }
    const attr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (attr) attr.needsUpdate = true;
    if (t >= 1) this.gliding = false;
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
