import type * as THREE from "three";
import { ecefToRender } from "@/lib/globe2/geo";
import type { CameraEngine } from "@/lib/globe2/camera";

/** Rendering-only bridge. All camera policy remains in CameraEngine. */
export function applyCameraToThree(engine: CameraEngine, camera: THREE.PerspectiveCamera,
  globeGroup: THREE.Group): void {
  const pose = engine.getPose();
  const origin = engine.getFloatingOrigin();
  const eye = ecefToRender(pose.eyeEcef, origin);
  const target = ecefToRender(pose.targetEcef, origin);
  const centre = ecefToRender({ x: 0, y: 0, z: 0 }, origin);
  camera.position.set(eye.x, eye.y, eye.z);
  camera.up.set(pose.upEcef.x, pose.upEcef.z, -pose.upEcef.y);
  camera.lookAt(target.x, target.y, target.z);
  const fovDeg = pose.verticalFovRad * 180 / Math.PI;
  const aspect = pose.viewportCss.width / pose.viewportCss.height;
  if (camera.fov !== fovDeg || camera.aspect !== aspect || camera.near !== pose.nearM || camera.far !== pose.farM) {
    camera.fov = fovDeg; camera.aspect = aspect; camera.near = pose.nearM; camera.far = pose.farM;
    camera.updateProjectionMatrix();
  }
  globeGroup.position.set(centre.x, centre.y, centre.z);
}
