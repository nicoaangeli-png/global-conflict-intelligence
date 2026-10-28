import type * as ThreeTypes from "three";
import { ecefToRender, toEcef } from "@/lib/globe2/geo";
import type { FloatingOrigin } from "@/lib/globe2/geo";
import { tileKey, tilePoint } from "@/lib/globe2/tiles";
import type { TileId, TileSnapshot } from "@/lib/globe2/tiles";

/** One LineSegments draw call for all visible debug patches. No React object per tile. */
export class TileDebugLayer {
  readonly group: ThreeTypes.Group;
  readonly lines: ThreeTypes.LineSegments;
  readonly patches: ThreeTypes.Mesh;
  private readonly THREE: typeof ThreeTypes;
  private lastSelection = "";
  private lastEpoch = -1;

  constructor(THREE: typeof ThreeTypes) {
    this.THREE = THREE;
    this.group = new THREE.Group();
    this.patches = new THREE.Mesh(new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.075,
        side: THREE.DoubleSide, depthWrite: false }));
    this.patches.frustumCulled = false;
    this.patches.visible = false;
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.82, depthWrite: false }));
    this.lines.frustumCulled = false;
    this.group.add(this.patches, this.lines);
  }

  setSurfaceVisible(visible: boolean): void {
    if (this.patches.visible === visible) return;
    this.patches.visible = visible;
    this.lastSelection = "";
    if (!visible) {
      this.patches.geometry.dispose();
      this.patches.geometry = new this.THREE.BufferGeometry();
    }
  }

  update(snapshot: TileSnapshot, origin: FloatingOrigin): void {
    if (this.lastSelection && this.lastEpoch === origin.originEpoch && snapshot.metrics.changes === 0) return;
    const signature = `${snapshot.strategy}|${origin.originEpoch}|${snapshot.visible.map(tileKey).join("|")}`;
    if (signature === this.lastSelection) return;
    this.lastSelection = signature;
    this.lastEpoch = origin.originEpoch;
    const positions: number[] = [], colors: number[] = [];
    const patchPositions: number[] = [], patchColors: number[] = [], patchIndices: number[] = [];
    const point = (id: TileId, u: number, v: number) => {
      const geo = tilePoint(id, u, v);
      const ecef = toEcef({ ...geo, heightM: Math.max(5, 50_000 / 2 ** id.z), datum: "WGS84" });
      const render = ecefToRender(ecef, origin);
      return [render.x, render.y, render.z];
    };
    for (const id of snapshot.visible) {
      const steps = id.z < 3 ? 24 : id.z < 6 ? 12 : 4;
      const base = snapshot.strategy === "cube" ? [0.20, 0.78, 0.90] : [0.36, 0.60, 0.94];
      const intensity = Math.min(1, 0.5 + id.z * 0.045);
      if (this.patches.visible) {
        const fillSteps = id.z === 0 ? 24 : id.z === 1 ? 12 : id.z === 2 ? 8 : id.z === 3 ? 6 : 4;
        const firstVertex = patchPositions.length / 3;
        const shade = (id.x + id.y) % 2 === 0 ? 0.7 : 1;
        for (let y = 0; y <= fillSteps; y++) for (let x = 0; x <= fillSteps; x++) {
          patchPositions.push(...point(id, x / fillSteps, y / fillSteps));
          patchColors.push(base[0] * shade, base[1] * shade, base[2] * shade);
        }
        for (let y = 0; y < fillSteps; y++) for (let x = 0; x < fillSteps; x++) {
          const a = firstVertex + y * (fillSteps + 1) + x, b = a + 1, c = a + fillSteps + 1, d = c + 1;
          patchIndices.push(a, b, d, a, d, c);
        }
      }
      for (let side = 0; side < 4; side++) for (let i = 0; i < steps; i++) {
        const a = i / steps, b = (i + 1) / steps;
        const uv = (t: number): [number, number] => side === 0 ? [t, 0] : side === 1 ? [1, t] :
          side === 2 ? [1 - t, 1] : [0, 1 - t];
        const [u0, v0] = uv(a), [u1, v1] = uv(b);
        positions.push(...point(id, u0, v0), ...point(id, u1, v1));
        for (let vertex = 0; vertex < 2; vertex++) colors.push(base[0] * intensity, base[1] * intensity, base[2] * intensity);
      }
    }
    const geometry = new this.THREE.BufferGeometry();
    geometry.setAttribute("position", new this.THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new this.THREE.Float32BufferAttribute(colors, 3));
    this.lines.geometry.dispose();
    this.lines.geometry = geometry;
    if (this.patches.visible) {
      const patchGeometry = new this.THREE.BufferGeometry();
      patchGeometry.setAttribute("position", new this.THREE.Float32BufferAttribute(patchPositions, 3));
      patchGeometry.setAttribute("color", new this.THREE.Float32BufferAttribute(patchColors, 3));
      patchGeometry.setIndex(patchIndices);
      this.patches.geometry.dispose();
      this.patches.geometry = patchGeometry;
    }
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as ThreeTypes.Material).dispose();
    this.patches.geometry.dispose();
    (this.patches.material as ThreeTypes.Material).dispose();
  }
}
