import type * as THREE from 'three';
import { CAMERA } from '@/lib/config/visual';
import { clusterDegreesForCamera } from '@/lib/clustering/cluster';
import { latLonToCameraAngles } from '@/lib/geo/latlon';
import { pinchDistance } from '@/lib/globeQuality';

/**
 * Caméra orbitale du globe, sans dépendance au rendu : coordonnées sphériques avec
 * cibles lissées, inertie après un glissé, rotation automatique après 25 s d'inactivité,
 * zoom molette / pincement / trackpad et recentrage. Testable sans WebGL.
 *
 * `GlobeScene` ne fait que brancher les événements du pointeur sur ces méthodes et
 * appeler `step` puis `applyTo` à chaque image.
 */

type CameraConfig = typeof CAMERA;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const PHI_MIN = 0.15;
const PHI_MAX = Math.PI - 0.15;
const AUTO_ROTATE_AFTER_MS = 25_000;

export class GlobeCameraController {
  distance: number;
  targetDistance: number;
  theta: number;
  targetTheta: number;
  phi: number;
  targetPhi: number;
  velocity = { theta: 0, phi: 0 };
  dragging = false;
  lastInteractionAt: number;

  constructor(private readonly config: CameraConfig = CAMERA, now = Date.now()) {
    this.distance = this.targetDistance = config.initial.distance;
    this.theta = this.targetTheta = config.initial.theta;
    this.phi = this.targetPhi = config.initial.phi;
    this.lastInteractionAt = now;
  }

  /** Taille de regroupement des foyers adaptée au zoom visé. */
  get clusterDegrees(): number {
    return clusterDegreesForCamera(this.targetDistance);
  }

  touch(now = Date.now()) {
    this.lastInteractionAt = now;
  }

  stop() {
    this.velocity = { theta: 0, phi: 0 };
  }

  /** Début d'un glissé : l'inertie précédente est annulée. */
  beginDrag(now = Date.now()) {
    this.dragging = true;
    this.stop();
    this.touch(now);
  }

  /** Rotation au glissé, proportionnelle à la distance (contrôle plus fin de près). */
  drag(deltaX: number, deltaY: number, now = Date.now()) {
    const scale = (this.targetDistance / this.config.initial.distance) * this.config.rotateSpeed;
    const vTheta = -deltaX * scale;
    const vPhi = -deltaY * scale;
    this.velocity = { theta: this.velocity.theta * 0.35 + vTheta * 0.65, phi: this.velocity.phi * 0.35 + vPhi * 0.65 };
    this.targetTheta += vTheta;
    this.targetPhi = clamp(this.targetPhi + vPhi, PHI_MIN, PHI_MAX);
    this.touch(now);
  }

  /** Pincement à deux doigts : distance inversement proportionnelle à l'écart. */
  pinch(previousSpan: number, span: number, now = Date.now()) {
    this.targetDistance = pinchDistance(this.targetDistance, previousSpan, span, this.config.minDistance, this.config.maxDistance);
    this.stop();
    this.touch(now);
  }

  /**
   * Molette et trackpad : pincement trackpad (ctrlKey) = zoom doux ; balayage horizontal à
   * deux doigts = rotation (jamais de zoom) ; molette classique = zoom exponentiel borné.
   */
  wheel(event: { deltaX: number; deltaY: number; ctrlKey: boolean }, now = Date.now()) {
    this.touch(now);
    const { deltaX, deltaY } = event;
    if (event.ctrlKey) {
      this.zoomBy(Math.exp(deltaY * 0.005), now);
    } else if (Math.abs(deltaX) > Math.abs(deltaY) || (Math.abs(deltaX) > 2 && Math.abs(deltaY) < 30)) {
      const rotScale = 0.0022;
      this.targetTheta += -deltaX * rotScale;
      this.targetPhi = clamp(this.targetPhi + -deltaY * rotScale, PHI_MIN, PHI_MAX);
      this.stop();
    } else {
      this.zoomBy(Math.exp(clamp(deltaY, -60, 60) * 0.0016), now);
    }
  }

  /** Facteur < 1 : zoom avant ; > 1 : zoom arrière. Borné par la configuration. */
  zoomBy(factor: number, now = Date.now()) {
    this.targetDistance = clamp(this.targetDistance * factor, this.config.minDistance, this.config.maxDistance);
    this.touch(now);
  }

  reset(now = Date.now()) {
    this.targetDistance = this.config.initial.distance;
    this.targetTheta = this.config.initial.theta;
    this.targetPhi = this.config.initial.phi;
    this.stop();
    this.touch(now);
  }

  northUp(now = Date.now()) {
    this.targetPhi = Math.PI / 2;
    this.velocity.phi = 0;
    this.touch(now);
  }

  /** Recentre sur un point par le plus court chemin, sans changer le zoom choisi. */
  focus(lat: number, lon: number, now = Date.now()) {
    const angles = latLonToCameraAngles(lat, lon);
    const twoPi = Math.PI * 2;
    this.targetTheta = this.theta + ((((angles.theta - this.theta) % twoPi) + twoPi * 1.5) % twoPi) - Math.PI;
    this.targetPhi = clamp(angles.phi, PHI_MIN, PHI_MAX);
    this.stop();
    this.touch(now);
  }

  /** Avance d'une image de `delta` secondes : inertie, rotation automatique, lissage. */
  step(delta: number, options: { reducedMotion: boolean; now?: number }) {
    const frameScale = delta * 60;
    const now = options.now ?? Date.now();
    if (!this.dragging && !options.reducedMotion) {
      const decay = this.config.damping ** frameScale;
      const inertiaScale = (1 - decay) / (1 - this.config.damping);
      this.targetTheta += this.velocity.theta * inertiaScale;
      this.targetPhi = clamp(this.targetPhi + this.velocity.phi * inertiaScale, PHI_MIN, PHI_MAX);
      this.velocity.theta *= decay;
      this.velocity.phi *= decay;
      if (now - this.lastInteractionAt > AUTO_ROTATE_AFTER_MS) this.targetTheta += this.config.autoRotate.speed * delta * 0.4;
    }
    const smoothing = options.reducedMotion ? 1 : 1 - 0.88 ** frameScale;
    this.theta += (this.targetTheta - this.theta) * smoothing;
    this.phi += (this.targetPhi - this.phi) * smoothing;
    this.distance += (this.targetDistance - this.distance) * smoothing;
  }

  applyTo(camera: THREE.PerspectiveCamera) {
    const sinPhi = Math.sin(this.phi);
    camera.position.x = this.distance * sinPhi * Math.sin(this.theta);
    camera.position.y = this.distance * Math.cos(this.phi);
    camera.position.z = this.distance * sinPhi * Math.cos(this.theta);
    camera.lookAt(0, 0, 0);
  }
}
