import type * as THREE from "three";
import type { RenderSurface } from "@/lib/geo/renderSurface";

/** The scene's navigation intentions. UI panels continue to use the existing store. */
export interface GlobeNavigation {
  readonly surface?: RenderSurface;
  dragging: boolean;
  readonly clusterDegrees: number;
  readonly viewDistanceM?: number;
  readonly cameraAggregationDegrees?: number;
  beginDrag(now?: number): void;
  drag(dx: number, dy: number, now?: number): void;
  pan?(dx: number, dy: number): void;
  tilt?(radians: number): void;
  pinch(previousSpan: number, span: number, now?: number): void;
  wheel(event: { deltaX: number; deltaY: number; ctrlKey: boolean; shiftKey?: boolean }, now?: number, pointer?: THREE.Vector2): void;
  zoomBy(factor: number, now?: number): void;
  focus(lat: number, lon: number, now?: number): void;
  reset(now?: number): void;
  northUp(now?: number): void;
  stop(): void;
  touch(now?: number): void;
  step(delta: number, options: { reducedMotion: boolean; now?: number }): void;
  applyTo(camera: THREE.PerspectiveCamera, globe?: THREE.Group): void;
  resize?(width: number, height: number, verticalFovDeg: number): void;
  groundAt?(x: number, y: number): { lat: number; lon: number } | null;
  reportFrame?(renderer: THREE.WebGLRenderer, delta: number, layersMs: number): void;
  dispose?(): void;
}

export type GlobeNavigationFactory = () => GlobeNavigation;
