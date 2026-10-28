import { fromEcef, toEcef, WGS84_B_M } from "../geo";
import type { CameraPose, ViewFootprint } from "../camera";
import { childTiles, rootTiles, tileBound, tileKey } from "./indexing";
import type { TileBound, TileId, TileLifecycle, TileMetrics, TileSelectionOptions,
  TileSnapshot, TileStrategy } from "./types";

const DEFAULTS: TileSelectionOptions = { maxDepth: 12, maxVisible: 256, targetSsePx: 2.5, hysteresis: 0.18 };
const EMPTY_METRICS: TileMetrics = { selected: 0, visible: 0, culledFrustum: 0, culledHorizon: 0,
  subdivisions: 0, changes: 0, minDepth: 0, maxDepth: 0, selectionMs: 0, visited: 0, cached: 0,
  maxScreenErrorPx: 0, budgetSaturated: false };
type Candidate = { id: TileId; bound: TileBound; sse: number };
const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Sphere/frustum test errs toward retention whenever a bounding sphere touches a plane. */
export function outsideFrustum(pose: CameraPose, bound: TileBound): boolean {
  const d = { x: bound.center.x - pose.eyeEcef.x, y: bound.center.y - pose.eyeEcef.y,
    z: bound.center.z - pose.eyeEcef.z };
  const depth = dot(d, pose.forwardEcef), r = bound.radiusM;
  if (depth + r < pose.nearM || depth - r > pose.farM) return true;
  const vertical = Math.tan(pose.verticalFovRad / 2);
  const horizontal = vertical * pose.viewportCss.width / pose.viewportCss.height;
  return Math.abs(dot(d, pose.rightEcef)) > Math.max(0, depth) * horizontal + r * Math.hypot(1, horizontal) ||
    Math.abs(dot(d, pose.upEcef)) > Math.max(0, depth) * vertical + r * Math.hypot(1, vertical);
}

/** Conservative geocentric horizon cone; WGS84 polar radius widens the visible cap. */
export function behindHorizon(pose: CameraPose, bound: TileBound): boolean {
  const eyeRadius = norm(pose.eyeEcef), centerRadius = norm(bound.center);
  if (eyeRadius <= WGS84_B_M || centerRadius <= bound.radiusM) return false;
  const horizon = Math.acos(clamp(WGS84_B_M / eyeRadius, -1, 1));
  const angularRadius = Math.asin(clamp(bound.radiusM / centerRadius, 0, 1));
  const separation = Math.acos(clamp(dot(pose.eyeEcef, bound.center) / (eyeRadius * centerRadius), -1, 1));
  return separation > horizon + angularRadius + 0.01;
}

function screenErrorPx(pose: CameraPose, bound: TileBound, eyeHeightM: number): number {
  const distance = Math.max(1, eyeHeightM, Math.hypot(bound.center.x - pose.eyeEcef.x,
    bound.center.y - pose.eyeEcef.y, bound.center.z - pose.eyeEcef.z) - bound.radiusM);
  return bound.geometricErrorM * pose.viewportCss.height /
    (2 * Math.tan(pose.verticalFovRad / 2) * distance);
}

/** Pure Tile/LOD controller. No Three.js, network request, terrain or imagery. */
export class TileEngine {
  private strategy: TileStrategy;
  private readonly options: TileSelectionOptions;
  private readonly bounds = new Map<string, TileBound>();
  private readonly lifecycle = new Map<string, TileLifecycle>();
  private splitLast = new Set<string>();
  private selectedLast = new Set<string>();
  private snapshot: TileSnapshot;
  private disposed = false;

  constructor(strategy: TileStrategy = "cube", options: Partial<TileSelectionOptions> = {}) {
    this.strategy = strategy;
    this.options = { ...DEFAULTS, ...options };
    if (!Number.isInteger(this.options.maxDepth) || this.options.maxDepth < 0 || this.options.maxDepth > 18 ||
        !Number.isInteger(this.options.maxVisible) || this.options.maxVisible < 6 || this.options.maxVisible > 4096 ||
        !Number.isFinite(this.options.targetSsePx) || this.options.targetSsePx <= 0 ||
        !Number.isFinite(this.options.hysteresis) || this.options.hysteresis < 0 || this.options.hysteresis >= 0.5) {
      throw new RangeError("Invalid tile selection budget");
    }
    this.snapshot = { strategy, revision: -1, originEpoch: -1, selected: [], visible: [], metrics: EMPTY_METRICS };
  }

  getStrategy(): TileStrategy { return this.strategy; }
  getSnapshot(): TileSnapshot { return this.snapshot; }
  getLifecycle(id: TileId): TileLifecycle { return this.lifecycle.get(tileKey(id)) ?? "idle"; }
  getBound(id: TileId): TileBound {
    const key = tileKey(id);
    let result = this.bounds.get(key);
    if (!result) { result = tileBound(id); this.bounds.set(key, result); }
    return result;
  }
  setStrategy(strategy: TileStrategy): void {
    if (this.disposed) throw new Error("Tile Engine disposed");
    if (strategy === this.strategy) return;
    this.strategy = strategy;
    this.splitLast.clear(); this.selectedLast.clear(); this.lifecycle.clear(); this.bounds.clear();
    this.snapshot = { strategy, revision: -1, originEpoch: -1, selected: [], visible: [], metrics: EMPTY_METRICS };
  }

  update(pose: CameraPose, footprint: ViewFootprint): TileSnapshot {
    if (this.disposed) throw new Error("Tile Engine disposed");
    if (pose.revision === this.snapshot.revision && pose.originEpoch === this.snapshot.originEpoch) return this.snapshot;
    const start = performance.now();
    const footprintCenter = footprint.center ? toEcef(footprint.center) : null;
    const eyeHeightM = Math.max(0, fromEcef(pose.eyeEcef).heightM);
    let culledFrustum = 0, culledHorizon = 0, visited = 0;
    const visible = (id: TileId): Candidate | null => {
      visited++;
      const bound = this.getBound(id);
      if (outsideFrustum(pose, bound)) { culledFrustum++; return null; }
      if (behindHorizon(pose, bound)) { culledHorizon++; return null; }
      // Footprint affects refinement priority, never exclusion: Phase 2 partial spans can be global.
      const centerBoost = footprintCenter && id.z > 0 &&
        dot(footprintCenter, bound.center) / (norm(footprintCenter) * norm(bound.center)) >
          Math.cos(Math.min(Math.PI, bound.angularSpanRad * 1.5)) ? 1.15 : 1;
      return { id, bound, sse: screenErrorPx(pose, bound, eyeHeightM) * centerBoost };
    };
    const leaves = rootTiles(this.strategy).map(visible).filter((item): item is Candidate => item !== null);
    const splits = new Set<string>();
    const blocked = new Set<string>();
    while (leaves.length < this.options.maxVisible) {
      let chosenIndex = -1, chosenSse = -Infinity;
      for (let i = 0; i < leaves.length; i++) {
        const candidate = leaves[i], key = tileKey(candidate.id);
        const threshold = this.options.targetSsePx * (this.splitLast.has(key)
          ? 1 - this.options.hysteresis : 1 + this.options.hysteresis);
        if (candidate.id.z < this.options.maxDepth && !blocked.has(key) && candidate.sse > threshold &&
            candidate.sse > chosenSse) { chosenIndex = i; chosenSse = candidate.sse; }
      }
      if (chosenIndex < 0) break;
      const parent = leaves[chosenIndex], key = tileKey(parent.id);
      const children = childTiles(parent.id).map(visible).filter((item): item is Candidate => item !== null);
      if (children.length === 0) {
        // All four children are conservatively culled; the coarse parent was only a loose bound.
        leaves.splice(chosenIndex, 1); continue;
      }
      if (leaves.length - 1 + children.length > this.options.maxVisible) {
        blocked.add(key); continue;
      }
      leaves.splice(chosenIndex, 1, ...children);
      splits.add(key);
    }
    let subdivisions = 0;
    for (const key of splits) if (!this.splitLast.has(key)) subdivisions++;
    const selected = leaves.map(item => item.id);
    const keys = new Set(selected.map(tileKey));
    let changes = 0;
    for (const key of keys) if (!this.selectedLast.has(key)) changes++;
    for (const key of this.selectedLast) if (!keys.has(key)) { changes++; this.lifecycle.set(key, "evictable"); }
    // Debug patches are generated synchronously. Lifecycle is explicit, without pretending to fetch terrain.
    for (const id of selected) {
      const key = tileKey(id);
      if (!this.lifecycle.has(key) || this.lifecycle.get(key) === "evictable") {
        this.lifecycle.set(key, "queued"); this.lifecycle.set(key, "loading"); this.lifecycle.set(key, "ready");
      }
      this.lifecycle.set(key, "visible");
    }
    this.selectedLast = keys;
    this.splitLast = splits;
    if (this.bounds.size > 8192) {
      for (const key of this.bounds.keys()) if (!keys.has(key) && !splits.has(key)) this.bounds.delete(key);
    }
    if (this.lifecycle.size > 4096) {
      for (const [key, state] of this.lifecycle) {
        if (this.lifecycle.size <= 4096) break;
        if (state === "evictable") this.lifecycle.delete(key);
      }
    }
    const depths = selected.map(id => id.z);
    const maxScreenErrorPx = leaves.length ? Math.max(...leaves.map(item => item.sse)) : 0;
    const metrics: TileMetrics = { selected: selected.length, visible: selected.length, culledFrustum,
      culledHorizon, subdivisions, changes, minDepth: depths.length ? Math.min(...depths) : 0,
      maxDepth: depths.length ? Math.max(...depths) : 0, selectionMs: performance.now() - start,
      visited, cached: this.bounds.size, maxScreenErrorPx,
      budgetSaturated: selected.length >= this.options.maxVisible && maxScreenErrorPx > this.options.targetSsePx };
    this.snapshot = { strategy: this.strategy, revision: pose.revision, originEpoch: pose.originEpoch,
      selected, visible: selected, metrics };
    return this.snapshot;
  }

  dispose(): void { this.disposed = true; this.bounds.clear(); this.lifecycle.clear(); this.splitLast.clear(); this.selectedLast.clear(); }
}
