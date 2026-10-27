import * as THREE from "three";
import { latLonToVector3 } from "@/lib/geo/latlon";
import type { CameraMarker } from "@/types/cameras";

/** One GPU draw call. Coarse views keep one preset per geographic cell. */
export class CameraLayer {
  readonly group = new THREE.Group();
  private points: THREE.Points;
  private material: THREE.ShaderMaterial;
  private shown: CameraMarker[] = [];
  private positions = new Float32Array(0);
  private selectedId: string | null = null;

  constructor(private readonly radius: number) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: `uniform float uPixelRatio; attribute float aMedia; varying float vFacing; varying float vMedia; void main(){vec4 world=modelMatrix*vec4(position,1.0);vFacing=dot(normalize(world.xyz),normalize(cameraPosition-world.xyz));vMedia=aMedia;gl_Position=projectionMatrix*viewMatrix*world;gl_PointSize=(aMedia>1.5?11.0:aMedia>0.5?8.0:6.0)*uPixelRatio;}`,
      fragmentShader: `varying float vFacing; varying float vMedia;void main(){if(vFacing<0.04)discard;float d=length(gl_PointCoord*2.0-1.0);float facing=smoothstep(0.04,0.2,vFacing);float a;vec3 c;if(vMedia>1.5){float ring=smoothstep(0.42,0.48,d)*(1.0-smoothstep(0.58,0.64,d));float core=1.0-smoothstep(0.10,0.20,d);a=(ring*0.68+core*0.32)*facing;c=vec3(0.82,0.98,1.0);}else if(vMedia>0.5){a=(1.0-smoothstep(0.55,0.78,d))*0.68*facing;c=vec3(0.38,0.86,0.94);}else{a=(1.0-smoothstep(0.55,0.75,d))*0.36*facing;c=vec3(0.33,0.58,0.70);}if(a<0.01)discard;gl_FragColor=vec4(c,a);}`,
      uniforms: { uPixelRatio: { value: 1 } },
      transparent: true, depthWrite: false, depthTest: false,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  setCameras(cameras: CameraMarker[], degrees: number, selectedId: string | null) {
    this.selectedId = selectedId;
    const cell = degrees > 2 ? 0.35 : degrees > 0.7 ? 0.12 : 0;
    const seen = new Set<string>();
    this.shown = [...cameras].sort((a, b) => (b.mediaType === "live_video" ? 2 : b.mediaType === "near_live_image" ? 1 : 0) - (a.mediaType === "live_video" ? 2 : a.mediaType === "near_live_image" ? 1 : 0)).filter((camera) => {
      if (!cell || camera.id === selectedId) return true;
      const key = `${Math.floor(camera.latitude / cell)}:${Math.floor(camera.longitude / cell)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    this.positions = new Float32Array(this.shown.length * 3);
    const media = new Float32Array(this.shown.length);
    this.shown.forEach((camera, index) => latLonToVector3(camera.latitude, camera.longitude, this.radius * 1.016).toArray(this.positions, index * 3));
    this.shown.forEach((camera, index) => { media[index] = camera.mediaType === "live_video" ? 2 : camera.mediaType === "near_live_image" ? 1 : 0; });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("aMedia", new THREE.BufferAttribute(media, 1));
    this.points.geometry.dispose();
    this.points.geometry = geometry;
  }

  setPixelRatio(value: number) { this.material.uniforms.uPixelRatio.value = value; }

  hitTest(camera: THREE.Camera, pointer: THREE.Vector2, width: number, height: number, matrixWorld: THREE.Matrix4, localCamera: THREE.Vector3): CameraMarker | null {
    if (!this.group.visible) return null;
    const point = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    let best = 9;
    let match: CameraMarker | null = null;
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
