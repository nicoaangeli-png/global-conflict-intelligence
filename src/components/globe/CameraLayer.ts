import * as THREE from "three";
import { latLonToVector3 } from "@/lib/geo/latlon";
import type { Camera } from "@/types/cameras";

/** One GPU draw call. Coarse views keep one preset per geographic cell. */
export class CameraLayer {
  readonly group = new THREE.Group();
  private points: THREE.Points;
  private material: THREE.ShaderMaterial;
  private shown: Camera[] = [];
  private positions = new Float32Array(0);
  private selectedId: string | null = null;

  constructor(private readonly radius: number) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: `uniform float uPixelRatio; varying float vFacing; void main(){vec4 world=modelMatrix*vec4(position,1.0);vFacing=dot(normalize(world.xyz),normalize(cameraPosition-world.xyz));gl_Position=projectionMatrix*viewMatrix*world;gl_PointSize=8.0*uPixelRatio;}`,
      fragmentShader: `varying float vFacing;void main(){if(vFacing<0.04)discard;float d=length(gl_PointCoord*2.0-1.0);float a=smoothstep(0.94,0.6,d)*smoothstep(0.04,0.2,vFacing);if(a<0.01)discard;gl_FragColor=vec4(0.55,0.91,1.0,a);}`,
      uniforms: { uPixelRatio: { value: 1 } },
      transparent: true, depthWrite: false, depthTest: false,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  setCameras(cameras: Camera[], degrees: number, selectedId: string | null) {
    this.selectedId = selectedId;
    const cell = degrees > 2 ? 0.35 : degrees > 0.7 ? 0.12 : 0;
    const seen = new Set<string>();
    this.shown = cameras.filter((camera) => {
      if (!cell || camera.id === selectedId) return true;
      const key = `${Math.floor(camera.latitude / cell)}:${Math.floor(camera.longitude / cell)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    this.positions = new Float32Array(this.shown.length * 3);
    this.shown.forEach((camera, index) => latLonToVector3(camera.latitude, camera.longitude, this.radius * 1.016).toArray(this.positions, index * 3));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.points.geometry.dispose();
    this.points.geometry = geometry;
  }

  setPixelRatio(value: number) { this.material.uniforms.uPixelRatio.value = value; }

  hitTest(camera: THREE.Camera, pointer: THREE.Vector2, width: number, height: number, matrixWorld: THREE.Matrix4, localCamera: THREE.Vector3): Camera | null {
    if (!this.group.visible) return null;
    const point = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    let best = 9;
    let match: Camera | null = null;
    for (let index = 0; index < this.shown.length; index++) {
      point.fromArray(this.positions, index * 3);
      if (toCamera.copy(localCamera).sub(point).dot(point) <= 0) continue;
      point.applyMatrix4(matrixWorld).project(camera);
      if (Math.abs(point.x) > 1 || Math.abs(point.y) > 1 || Math.abs(point.z) > 1) continue;
      const distance = Math.hypot((point.x - pointer.x) * width / 2, (point.y - pointer.y) * height / 2);
      if (distance < best) { best = distance; match = this.shown[index]; }
    }
    return match;
  }

  dispose() { this.points.geometry.dispose(); this.material.dispose(); }
}
