import type { EcefMeters, GeoBBox, GeoPoint, Vec3 } from "../geo";

export type CameraMode = "orbit" | "surface" | "track";
export type CommandSource = "user" | "feed" | "aura" | "timeline";
export type MapAnchor = Readonly<{ latDeg: number; lonDeg: number }>;
export type CameraTarget = Readonly<{ id: string; position: MapAnchor; radiusM?: number }>;
export type Viewport = Readonly<{ width: number; height: number }>;
export type Easing = "smooth" | "linear";

export type CameraState = Readonly<{
  eye: GeoPoint;
  target: GeoPoint;
  headingRad: number;
  pitchRad: number;
  rollRad: number;
  verticalFovRad: number;
  viewportCss: Viewport;
  mode: CameraMode;
  distanceM: number;
  velocity: Readonly<{ orbitX: number; orbitY: number }>;
  activeCommandId: string | null;
  trackingId: string | null;
  revision: number;
  originEpoch: number;
  rebaseCount: number;
  engineFrameMs: number;
}>;

export type CameraPose = Readonly<{
  eyeEcef: EcefMeters;
  targetEcef: EcefMeters;
  upEcef: Vec3;
  forwardEcef: Vec3;
  rightEcef: Vec3;
  verticalFovRad: number;
  viewportCss: Viewport;
  nearM: number;
  farM: number;
  originEpoch: number;
  revision: number;
}>;

export type ViewFootprint = Readonly<{
  center: GeoPoint | null;
  spans: readonly GeoBBox[];
  crossesAntimeridian: boolean;
  groundSpanM: number | null;
  horizonVisible: boolean;
  partial: boolean;
  revision: number;
}>;

type BaseCommand<Action extends string> = Readonly<{
  id: string;
  source: CommandSource;
  action: Action;
  issuedAt: string;
}>;

export type FlyToCommand = BaseCommand<"flyTo"> & Readonly<{ payload: {
  target: CameraTarget;
  framing: "center" | "fit";
  distanceM: number;
  durationMs?: number;
  easing?: Easing;
  headingRad?: number;
  pitchRad?: number;
} }>;
export type FocusCommand = BaseCommand<"focus"> & Readonly<{ payload: { target: CameraTarget } }>;
export type TrackCommand = BaseCommand<"track"> & Readonly<{ payload: {
  target: Readonly<{ kind: "mobile" | "satellite"; id: string }>;
  enabled: boolean;
} }>;
export type CameraCommand = FlyToCommand | FocusCommand | TrackCommand;
export type CommandResult = Readonly<{ id: string; status: "accepted" | "completed" | "cancelled" | "failed"; reason?: string }>;

export type FlyToOptions = Readonly<{
  target: MapAnchor;
  distanceM: number;
  framing?: "center" | "fit";
  targetRadiusM?: number;
  durationMs?: number;
  easing?: Easing;
  headingRad?: number;
  pitchRad?: number;
  id?: string;
  source?: CommandSource;
}>;
