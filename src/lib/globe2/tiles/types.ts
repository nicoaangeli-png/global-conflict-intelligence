import type { CameraPose, ViewFootprint } from "../camera";
import type { EcefMeters, GeoBBox } from "../geo";

export type TileStrategy = "cube" | "geographic";
export type CubeFace = "px" | "nx" | "py" | "ny" | "pz" | "nz";
export type GeographicFace = "west" | "east";
export type TileId = Readonly<{ strategy: "cube"; face: CubeFace; z: number; x: number; y: number }>
  | Readonly<{ strategy: "geographic"; face: GeographicFace; z: number; x: number; y: number }>;
export type TileLifecycle = "idle" | "queued" | "loading" | "ready" | "visible" | "evictable" | "failed";
export type TileSide = "west" | "east" | "south" | "north";
export type TileGeoPoint = Readonly<{ latDeg: number; lonDeg: number }>;
export type TileBound = Readonly<{
  center: EcefMeters;
  radiusM: number;
  geographic: readonly GeoBBox[];
  angularSpanRad: number;
  geometricErrorM: number;
}>;
export type TileSelectionOptions = Readonly<{
  maxDepth: number;
  maxVisible: number;
  targetSsePx: number;
  hysteresis: number;
}>;
export type TileMetrics = Readonly<{
  selected: number;
  visible: number;
  culledFrustum: number;
  culledHorizon: number;
  subdivisions: number;
  changes: number;
  minDepth: number;
  maxDepth: number;
  selectionMs: number;
  visited: number;
  cached: number;
  maxScreenErrorPx: number;
  budgetSaturated: boolean;
}>;
export type TileSnapshot = Readonly<{
  strategy: TileStrategy;
  revision: number;
  originEpoch: number;
  selected: readonly TileId[];
  visible: readonly TileId[];
  metrics: TileMetrics;
}>;
export type TileView = Readonly<{ pose: CameraPose; footprint: ViewFootprint }>;
