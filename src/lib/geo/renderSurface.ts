import { SphereGeometry, Vector3 } from "three";
import type { BufferGeometry } from "three";
import { latLonToVector3 } from "./latlon";

export type RenderProjector = (lat: number, lon: number, radius?: number, target?: Vector3) => Vector3;

/** Rendering dependency of the existing V1 layers. It never changes their source records. */
export interface RenderSurface {
  readonly kind: "sphere" | "wgs84";
  readonly point: RenderProjector;
  vertexShader(source: string): string;
  visible(point: Vector3, localCamera: Vector3): boolean;
  geometry(radius: number, width: number, height: number, atmosphericShell?: boolean): BufferGeometry;
  /** Optional, explicit surface interpolation for observed tracks/cables; no extrapolation. */
  arc?(a: { lat: number; lon: number }, b: { lat: number; lon: number }, radius: number): Vector3[];
  resurface?(point: Vector3, radius: number): Vector3;
}

/** Exact legacy defaults. Production `/` keeps its original spatial/rendering policy. */
export const SPHERE_SURFACE: RenderSurface = {
  kind: "sphere",
  point: latLonToVector3,
  vertexShader: source => source,
  visible: (point, camera) => (camera.x - point.x) * point.x
    + (camera.y - point.y) * point.y + (camera.z - point.z) * point.z > 0,
  geometry: (radius, width, height) => new SphereGeometry(radius, width, height),
};
