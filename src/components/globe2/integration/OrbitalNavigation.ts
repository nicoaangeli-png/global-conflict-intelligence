import type * as THREE from "three";
import { CAMERA } from "@/lib/config/visual";
import { clusterDegreesForCamera } from "@/lib/clustering/cluster";
import { CameraEngine, groundAtNdc } from "@/lib/globe2/camera";
import { ecefToRender, WGS84_A_M } from "@/lib/globe2/geo";
import { TileEngine } from "@/lib/globe2/tiles";
import { viewScale, type ViewScale } from "@/lib/globe2/viewScale";
import type { GlobeNavigation } from "@/components/globe/GlobeNavigation";
import { WGS84_SURFACE } from "./Wgs84RenderSurface";

/** V1 store/interaction contract → proprietary Camera Engine. Three.js receives a pose only. */
export class OrbitalNavigation implements GlobeNavigation {
  readonly surface = WGS84_SURFACE;
  readonly engine = new CameraEngine();
  readonly tiles = new TileEngine("cube", { maxVisible: 128 });
  private isDragging = false;
  private reducedMotion = false;
  private scale: ViewScale = "PLANET";
  private nextReport = 0;
  private nextTiles = 0;
  private frameCount = 0;
  private frameSeconds = 0;
  private layerSumMs = 0;
  private maxLayerMs = 0;
  private lastRevision = -1;
  private lastInteractionAt = Date.now();

  constructor() { this.home(Date.now(), true); }
  get dragging() { return this.isDragging; }
  set dragging(value: boolean) { this.isDragging = value; if (!value) this.engine.endGesture(); }
  get clusterDegrees() { return clusterDegreesForCamera(1 + this.engine.getState().distanceM / WGS84_A_M); }
  get viewDistanceM() { return this.engine.getState().distanceM; }
  get cameraAggregationDegrees() {
    return this.scale === 'CITY' || this.scale === 'DISTRICT' || this.scale === 'SENSOR' ? 0
      : this.scale === 'REGION' ? 1 : this.scale === 'COUNTRY' ? 2 : 8;
  }
  beginDrag(now = Date.now()) { this.touch(now); this.isDragging = true; this.engine.beginGesture(now); }
  drag(dx: number, dy: number, now = Date.now()) { this.touch(now); this.engine.orbit(dx, dy, now, this.reducedMotion); }
  pan(dx: number, dy: number) { this.touch(); this.engine.pan(dx, dy); }
  tilt(rad: number) { this.touch(); this.engine.tilt(rad); }
  pinch(previous: number, current: number, now = Date.now()) {
    this.touch(now); if (previous > 0 && current > 0) this.engine.zoomBy(previous / current, now);
  }
  wheel(event: { deltaX: number; deltaY: number; ctrlKey: boolean; shiftKey?: boolean }, now = Date.now(), pointer?: THREE.Vector2) {
    this.touch(now);
    if (event.shiftKey) return this.engine.tilt(event.deltaY * 0.002, now);
    if (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) return this.engine.orbit(event.deltaX, event.deltaY, now, this.reducedMotion);
    const factor = Math.exp(Math.max(-120, Math.min(120, event.deltaY)) * (event.ctrlKey ? 0.005 : 0.0016));
    if (pointer && Math.abs(pointer.x) <= 1 && Math.abs(pointer.y) <= 1) this.engine.zoomAtPointer(factor, pointer.x, pointer.y, now);
    else this.engine.zoomBy(factor, now);
  }
  zoomBy(factor: number, now = Date.now()) { this.touch(now); this.engine.zoomBy(factor, now); }
  focus(lat: number, lon: number, now = Date.now()) {
    this.touch(now);
    this.engine.flyTo({ target: { latDeg: lat, lonDeg: lon }, distanceM: this.engine.getState().distanceM,
      id: `store-focus-${now}`, source: "user", durationMs: 1100 }, now, this.reducedMotion);
  }
  reset(now = Date.now()) {
    this.home(now, false);
  }
  private home(now: number, immediate: boolean) {
    this.touch(now);
    this.engine.flyTo({ target: { latDeg: 90 - CAMERA.initial.phi * 180 / Math.PI,
      lonDeg: (CAMERA.initial.theta - Math.PI / 2) * 180 / Math.PI },
      distanceM: (CAMERA.initial.distance - 1) * WGS84_A_M, headingRad: 0, pitchRad: 0,
      durationMs: immediate ? 0 : 1100, id: `reset-${now}`, source: "user" }, now, immediate || this.reducedMotion);
  }
  northUp(now = Date.now()) { this.touch(now); this.engine.northUp(now); }
  stop() { this.touch(); this.engine.stop(); }
  touch(now = Date.now()) { this.lastInteractionAt = now; }
  resize(width: number, height: number, fovDeg: number) {
    this.engine.setViewport({ width, height }); this.engine.setVerticalFov(fovDeg * Math.PI / 180);
  }
  step(delta: number, options: { reducedMotion: boolean; now?: number }) {
    this.reducedMotion = options.reducedMotion;
    const time = options.now ?? Date.now();
    this.engine.step(delta, time, options.reducedMotion);
    const current = this.engine.getState();
    if (!this.isDragging && !options.reducedMotion && !current.activeCommandId
      && current.distanceM > WGS84_A_M && time - this.lastInteractionAt > 25_000) {
      // Preserve V1's idle orbital drift. It is an automation command, never a user gesture.
      this.engine.flyTo({ target: { latDeg: current.target.latDeg,
        lonDeg: current.target.lonDeg + CAMERA.autoRotate.speed * delta * 0.4 * 180 / Math.PI },
        distanceM: current.distanceM, durationMs: 0, source: "timeline", id: `idle-${time}` }, time);
    }
    const now = performance.now();
    if (now >= this.nextTiles && this.lastRevision !== this.engine.getState().revision) {
      this.nextTiles = now + 200;
      const state = this.engine.getState(), footprint = this.engine.getViewFootprint();
      this.scale = viewScale(state, footprint, this.scale);
      this.tiles.update(this.engine.getPose(), footprint);
      this.lastRevision = state.revision;
    }
  }
  applyTo(camera: THREE.PerspectiveCamera, globe?: THREE.Group) {
    const pose = this.engine.getPose(), origin = this.engine.getFloatingOrigin();
    const eye = ecefToRender(pose.eyeEcef, origin), target = ecefToRender(pose.targetEcef, origin);
    const centre = ecefToRender({ x: 0, y: 0, z: 0 }, origin);
    // Render-unit normalization preserves V1 shader sizes; canonical engine units stay metres.
    camera.position.set(eye.x / WGS84_A_M, eye.y / WGS84_A_M, eye.z / WGS84_A_M);
    camera.up.set(pose.upEcef.x, pose.upEcef.z, -pose.upEcef.y);
    camera.lookAt(target.x / WGS84_A_M, target.y / WGS84_A_M, target.z / WGS84_A_M);
    const fov = pose.verticalFovRad * 180 / Math.PI, aspect = pose.viewportCss.width / pose.viewportCss.height;
    // V1's decorative starfield extends to 26 Earth radii. It must not be clipped
    // by the geospatial footprint's far range; Tile Engine still uses pose.farM.
    const near = pose.nearM / WGS84_A_M, far = Math.max(CAMERA.far, pose.farM / WGS84_A_M);
    if (camera.fov !== fov || camera.aspect !== aspect || camera.near !== near || camera.far !== far) {
      camera.fov = fov; camera.aspect = aspect; camera.near = near; camera.far = far; camera.updateProjectionMatrix();
    }
    globe?.position.set(centre.x / WGS84_A_M, centre.y / WGS84_A_M, centre.z / WGS84_A_M);
  }
  groundAt(x: number, y: number) {
    const p = groundAtNdc(this.engine.getPose(), x, y);
    return p ? { lat: p.latDeg, lon: p.lonDeg } : null;
  }
  reportFrame(renderer: THREE.WebGLRenderer, delta: number, layersMs: number) {
    this.frameCount++; this.frameSeconds += delta; this.layerSumMs += layersMs; this.maxLayerMs = Math.max(this.maxLayerMs, layersMs);
    const now = performance.now();
    if (now < this.nextReport) return;
    this.nextReport = now + 500;
    const state = this.engine.getState();
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    renderer.domElement.dataset.globe2 = JSON.stringify({ revision: state.revision, scale: this.scale,
      target: state.target, distanceM: state.distanceM, pitchRad: state.pitchRad,
      command: state.activeCommandId, originEpoch: state.originEpoch, rebases: state.rebaseCount,
      fps: this.frameCount / Math.max(0.001, this.frameSeconds), frameMs: this.frameSeconds * 1000 / this.frameCount,
      layersMs: this.layerSumMs / this.frameCount, maxLayersMs: this.maxLayerMs, engineMs: state.engineFrameMs,
      calls: renderer.info.render.calls, points: renderer.info.render.points, triangles: renderer.info.render.triangles,
      lines: renderer.info.render.lines,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
      heapBytes: memory?.usedJSHeapSize ?? null, tiles: this.tiles.getSnapshot().metrics });
    this.frameCount = 0; this.frameSeconds = 0; this.layerSumMs = 0; this.maxLayerMs = 0;
  }
  dispose() { this.tiles.dispose(); this.engine.dispose(); }
}
