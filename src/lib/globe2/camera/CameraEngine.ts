import type { GeoPoint } from "../geo";
import { chordDistanceMeters, createFloatingOrigin, ecefToEnu, enuFrame, fromEcef,
  rebaseFloatingOrigin, toEcef, WGS84_A_M } from "../geo";
import type { FloatingOrigin } from "../geo";
import { computeViewFootprint, groundAtNdc } from "./footprint";
import { anchor, clamp, finite, MAX_DISTANCE_M, MAX_TILT_RAD, MIN_CLEARANCE_M,
  MIN_DISTANCE_M, moveAnchor, poseFor, RAD, shortestAngle, slerpAnchor, validateAnchor } from "./math";
import type { CameraCommand, CameraPose, CameraState, CommandResult, FlyToOptions,
  MapAnchor, ViewFootprint, Viewport } from "./types";

type Fly = Readonly<{
  id: string; source: CameraCommand["source"]; from: GeoPoint; to: GeoPoint;
  startDistanceM: number; endDistanceM: number;
  startHeadingRad: number; endHeadingRad: number;
  startPitchRad: number; endPitchRad: number;
  startedAtMs: number; durationMs: number; easing: "smooth" | "linear";
}>;

/** Pure, mutable camera controller. Only ECEF/ENU/Geo Core own world coordinates. */
export class CameraEngine {
  private target = anchor(20, 0);
  private distanceM = 20_000_000;
  private desiredDistanceM = this.distanceM;
  private headingRad = 0;
  private pitchRad = 0;
  private verticalFovRad = 50 * RAD;
  private viewportCss: Viewport;
  private mode: CameraState["mode"] = "orbit";
  private velocity = { orbitX: 0, orbitY: 0 };
  private dragging = false;
  private fly: Fly | null = null;
  private trackingId: string | null = null;
  private revision = 0;
  private origin: FloatingOrigin;
  private rebaseCount = 0;
  private lastUserAtMs = -Infinity;
  private lastCommandResult: CommandResult | null = null;
  private engineFrameMs = 0;
  private poseCache: CameraPose | null = null;
  private footprintCache: ViewFootprint | null = null;
  private disposed = false;

  constructor(viewportCss: Viewport = { width: 1440, height: 900 }) {
    this.viewportCss = validateViewport(viewportCss);
    this.origin = createFloatingOrigin(poseFor(this.target, this.distanceM, 0, 0).eyeEcef);
  }

  private invalidate(): void { this.revision++; this.poseCache = null; this.footprintCache = null; }
  private ensureActive(): void { if (this.disposed) throw new Error("Camera Engine disposed"); }
  private userInterrupt(nowMs: number): void {
    this.ensureActive();
    if (!Number.isFinite(nowMs)) throw new RangeError("Invalid interaction time");
    this.lastUserAtMs = Math.max(this.lastUserAtMs, nowMs);
    if (this.fly) this.lastCommandResult = { id: this.fly.id, status: "cancelled", reason: "user-interaction" };
    this.fly = null;
    this.trackingId = null;
    if (this.mode === "track") this.mode = "orbit";
  }

  getState(): CameraState {
    this.ensureActive();
    return {
      eye: fromEcef(this.getPose().eyeEcef), target: this.target,
      headingRad: this.headingRad, pitchRad: this.pitchRad, rollRad: 0,
      verticalFovRad: this.verticalFovRad, viewportCss: { ...this.viewportCss },
      mode: this.mode, distanceM: this.distanceM, velocity: { ...this.velocity },
      activeCommandId: this.fly?.id ?? null, trackingId: this.trackingId,
      revision: this.revision, originEpoch: this.origin.originEpoch,
      rebaseCount: this.rebaseCount, engineFrameMs: this.engineFrameMs,
    };
  }

  getPose(): CameraPose {
    this.ensureActive();
    if (this.poseCache) return this.poseCache;
    const axes = poseFor(this.target, this.distanceM, this.headingRad, this.pitchRad);
    const eyeHeightM = Math.max(0, fromEcef(axes.eyeEcef).heightM);
    const thresholdM = Math.max(500, eyeHeightM * 0.15);
    if (chordDistanceMeters(axes.eyeEcef, this.origin.origin) > thresholdM) {
      this.origin = rebaseFloatingOrigin(this.origin, axes.eyeEcef);
      this.rebaseCount++;
    }
    const nearM = clamp(eyeHeightM * 0.02, 0.5, 10_000);
    const farM = Math.max(this.distanceM + 2 * WGS84_A_M, 16_000_000);
    this.poseCache = { ...axes, verticalFovRad: this.verticalFovRad, viewportCss: this.viewportCss,
      nearM, farM, originEpoch: this.origin.originEpoch, revision: this.revision };
    return this.poseCache;
  }

  getFloatingOrigin(): FloatingOrigin { this.getPose(); return this.origin; }
  getViewFootprint(): ViewFootprint {
    if (!this.footprintCache) this.footprintCache = computeViewFootprint(this.getPose());
    return this.footprintCache;
  }

  setViewport(viewport: Viewport): void {
    this.ensureActive(); const next = validateViewport(viewport);
    if (next.width !== this.viewportCss.width || next.height !== this.viewportCss.height) {
      this.viewportCss = next; this.invalidate();
    }
  }

  setVerticalFov(rad: number): void {
    this.ensureActive();
    if (!Number.isFinite(rad) || rad < 20 * RAD || rad > 100 * RAD) throw new RangeError("FOV must be 20–100 degrees");
    if (rad !== this.verticalFovRad) { this.verticalFovRad = rad; this.invalidate(); }
  }

  beginGesture(nowMs = Date.now()): void {
    this.userInterrupt(nowMs);
    this.dragging = true;
    this.velocity = { orbitX: 0, orbitY: 0 };
  }

  endGesture(): void { this.ensureActive(); this.dragging = false; }

  /** Pointer delta in CSS pixels. A short-lived angular velocity supplies inertia. */
  orbit(deltaX: number, deltaY: number, nowMs = Date.now(), reducedMotion = false): void {
    this.userInterrupt(nowMs);
    if (!finite(deltaX, deltaY)) throw new RangeError("Invalid orbit delta");
    const radPerPx = this.verticalFovRad / this.viewportCss.height * clamp(this.distanceM / WGS84_A_M, 0.00002, 1.5);
    const eastM = -deltaX * radPerPx * WGS84_A_M;
    const northM = deltaY * radPerPx * WGS84_A_M;
    this.target = moveAnchor(this.target, eastM, northM);
    this.velocity = reducedMotion ? { orbitX: 0, orbitY: 0 } :
      { orbitX: clamp(deltaX, -40, 40), orbitY: clamp(deltaY, -40, 40) };
    this.invalidate();
  }

  pan(deltaX: number, deltaY: number, nowMs = Date.now()): void {
    this.userInterrupt(nowMs);
    if (!finite(deltaX, deltaY)) throw new RangeError("Invalid pan delta");
    const metresPerPx = 2 * this.distanceM * Math.tan(this.verticalFovRad / 2) / this.viewportCss.height;
    this.target = moveAnchor(this.target, -deltaX * metresPerPx, deltaY * metresPerPx);
    this.velocity = { orbitX: 0, orbitY: 0 };
    this.invalidate();
  }

  zoomBy(factor: number, nowMs = Date.now()): void {
    this.userInterrupt(nowMs);
    if (!Number.isFinite(factor) || factor <= 0) throw new RangeError("Invalid zoom factor");
    this.desiredDistanceM = clamp(this.desiredDistanceM * factor, MIN_DISTANCE_M, MAX_DISTANCE_M);
    this.velocity = { orbitX: 0, orbitY: 0 };
    this.invalidate();
  }

  zoomAtPointer(factor: number, ndcX: number, ndcY: number, nowMs = Date.now()): void {
    this.ensureActive();
    if (!finite(ndcX, ndcY) || Math.abs(ndcX) > 1 || Math.abs(ndcY) > 1) throw new RangeError("Invalid pointer position");
    const before = groundAtNdc(this.getPose(), ndcX, ndcY);
    this.zoomBy(factor, nowMs);
    if (!before) return;
    // Use the end-distance pose so the surface point stays under the pointer after zoom.
    const afterPose = this.poseAtDistance(this.desiredDistanceM);
    const after = groundAtNdc(afterPose, ndcX, ndcY);
    if (!after) return;
    const frame = enuFrame(this.target);
    const beforeLocal = ecefToEnu(toEcef(before), frame);
    const afterLocal = ecefToEnu(toEcef(after), frame);
    this.target = moveAnchor(this.target, beforeLocal.east - afterLocal.east, beforeLocal.north - afterLocal.north);
    this.invalidate();
  }

  tilt(deltaRad: number, nowMs = Date.now()): void {
    this.userInterrupt(nowMs);
    if (!Number.isFinite(deltaRad)) throw new RangeError("Invalid tilt");
    this.pitchRad = this.safePitch(this.pitchRad + deltaRad);
    this.velocity = { orbitX: 0, orbitY: 0 };
    this.invalidate();
  }

  northUp(nowMs = Date.now()): void {
    this.userInterrupt(nowMs);
    this.headingRad = 0; this.velocity = { orbitX: 0, orbitY: 0 }; this.invalidate();
  }

  reset(nowMs = Date.now()): void {
    this.userInterrupt(nowMs);
    this.target = anchor(20, 0); this.distanceM = this.desiredDistanceM = 20_000_000;
    this.headingRad = this.pitchRad = 0; this.mode = "orbit";
    this.velocity = { orbitX: 0, orbitY: 0 }; this.invalidate();
  }

  setMode(mode: CameraState["mode"], nowMs = Date.now()): void {
    this.userInterrupt(nowMs);
    if (!["orbit", "surface", "track"].includes(mode)) throw new RangeError("Invalid camera mode");
    this.mode = mode; this.invalidate();
  }

  flyTo(options: FlyToOptions, nowMs = Date.now(), reducedMotion = false): CommandResult {
    this.ensureActive(); validateAnchor(options.target);
    if (!Number.isFinite(options.distanceM) || options.distanceM < MIN_DISTANCE_M || options.distanceM > MAX_DISTANCE_M ||
        !Number.isFinite(nowMs)) throw new RangeError("Invalid fly-to target, distance or time");
    const targetRadiusM = options.targetRadiusM;
    if (options.framing === "fit" && (typeof targetRadiusM !== "number" || !Number.isFinite(targetRadiusM) || targetRadiusM <= 0)) {
      throw new RangeError("Fit framing requires a positive target radius");
    }
    const fitDistanceM = options.framing === "fit"
      ? (targetRadiusM ?? 0) * 1.2 / Math.tan(this.verticalFovRad / 2)
      : options.distanceM;
    const endDistanceM = clamp(Math.max(options.distanceM, fitDistanceM), MIN_DISTANCE_M, MAX_DISTANCE_M);
    const durationMs = reducedMotion ? 0 : clamp(options.durationMs ?? 1600, 0, 8000);
    if (!Number.isFinite(durationMs)) throw new RangeError("Invalid duration");
    const headingRad = options.headingRad ?? this.headingRad;
    const pitchRad = options.pitchRad ?? this.pitchRad;
    if (!finite(headingRad, pitchRad)) throw new RangeError("Invalid orientation");
    const id = options.id ?? `fly-${nowMs}`;
    if ((options.source ?? "user") === "user") this.userInterrupt(nowMs);
    if (this.fly) this.lastCommandResult = { id: this.fly.id, status: "cancelled", reason: "superseded" };
    this.trackingId = null;
    this.mode = "orbit";
    this.velocity = { orbitX: 0, orbitY: 0 };
    this.fly = { id, source: options.source ?? "user", from: this.target,
      to: anchor(options.target.latDeg, options.target.lonDeg),
      startDistanceM: this.distanceM, endDistanceM,
      startHeadingRad: this.headingRad, endHeadingRad: headingRad,
      startPitchRad: this.pitchRad, endPitchRad: clamp(pitchRad, 0, MAX_TILT_RAD),
      startedAtMs: nowMs, durationMs, easing: options.easing ?? "smooth" };
    this.lastCommandResult = { id, status: "accepted" };
    this.invalidate();
    if (durationMs === 0) this.step(0, nowMs, reducedMotion);
    return this.lastCommandResult;
  }

  dispatch(command: CameraCommand, nowMs = Date.now(), reducedMotion = false): CommandResult {
    this.ensureActive();
    const issuedAtMs = Date.parse(command.issuedAt);
    if (!Number.isFinite(issuedAtMs) || !command.id ||
        !["user", "feed", "aura", "timeline"].includes(command.source)) {
      return { id: command.id, status: "failed", reason: "invalid-command" };
    }
    if (command.source !== "user" && issuedAtMs <= this.lastUserAtMs) {
      return { id: command.id, status: "cancelled", reason: "newer-user-interaction" };
    }
    if (command.action === "flyTo") {
      if (!command.payload.target.id) return { id: command.id, status: "failed", reason: "invalid-target" };
      try {
        return this.flyTo({ ...command.payload, target: command.payload.target.position,
          targetRadiusM: command.payload.target.radiusM,
          id: command.id, source: command.source }, nowMs, reducedMotion);
      } catch (error) {
        if (error instanceof RangeError) return { id: command.id, status: "failed", reason: error.message };
        throw error;
      }
    }
    if (command.action === "focus") {
      if (!command.payload.target.id) return { id: command.id, status: "failed", reason: "invalid-target" };
      try {
        return this.flyTo({ target: command.payload.target.position, distanceM: this.distanceM,
          durationMs: 900, id: command.id, source: command.source }, nowMs, reducedMotion);
      } catch (error) {
        if (error instanceof RangeError) return { id: command.id, status: "failed", reason: error.message };
        throw error;
      }
    }
    if (command.action === "track") {
      if (!command.payload.target.id) return { id: command.id, status: "failed", reason: "invalid-target" };
      if (this.fly) this.lastCommandResult = { id: this.fly.id, status: "cancelled", reason: "superseded" };
      this.fly = null;
      this.trackingId = command.payload.enabled ? command.payload.target.id : null;
      this.mode = this.trackingId ? "track" : "orbit";
      this.invalidate();
      return { id: command.id, status: "completed" };
    }
    throw new Error("Unsupported camera command");
  }

  updateTrackedTarget(id: string, position: MapAnchor): void {
    this.ensureActive();
    if (this.trackingId !== id) return;
    validateAnchor(position);
    this.target = anchor(position.latDeg, position.lonDeg);
    this.invalidate();
  }

  stop(nowMs = Date.now()): void { this.userInterrupt(nowMs); this.velocity = { orbitX: 0, orbitY: 0 }; this.invalidate(); }

  /** Delta seconds, explicit wall-clock milliseconds; no WebGL or browser dependency. */
  step(deltaSeconds: number, nowMs = Date.now(), reducedMotion = false): void {
    this.ensureActive();
    if (!finite(deltaSeconds, nowMs) || deltaSeconds < 0) throw new RangeError("Invalid frame time");
    const start = performance.now();
    const dt = clamp(deltaSeconds, 0, 0.1);
    if (this.fly) {
      const fly = this.fly;
      const raw = fly.durationMs === 0 ? 1 : clamp((nowMs - fly.startedAtMs) / fly.durationMs, 0, 1);
      const t = fly.easing === "linear" ? raw : raw * raw * (3 - 2 * raw);
      this.target = slerpAnchor(fly.from, fly.to, t);
      this.distanceM = this.desiredDistanceM = Math.exp(Math.log(fly.startDistanceM) * (1 - t) + Math.log(fly.endDistanceM) * t);
      this.headingRad = fly.startHeadingRad + shortestAngle(fly.startHeadingRad, fly.endHeadingRad) * t;
      this.pitchRad = this.safePitch(fly.startPitchRad + (fly.endPitchRad - fly.startPitchRad) * t);
      if (raw >= 1) {
        this.fly = null;
        this.lastCommandResult = { id: fly.id, status: "completed" };
      }
      this.invalidate();
    } else {
      if (!this.dragging && !reducedMotion && Math.abs(this.velocity.orbitX) + Math.abs(this.velocity.orbitY) > 0.02) {
        const decay = Math.exp(-8 * dt);
        const pxX = this.velocity.orbitX * dt * 18, pxY = this.velocity.orbitY * dt * 18;
        const radPerPx = this.verticalFovRad / this.viewportCss.height * clamp(this.distanceM / WGS84_A_M, 0.00002, 1.5);
        this.target = moveAnchor(this.target, -pxX * radPerPx * WGS84_A_M, pxY * radPerPx * WGS84_A_M);
        this.velocity.orbitX *= decay; this.velocity.orbitY *= decay;
        this.invalidate();
      } else if (!this.dragging && (this.velocity.orbitX !== 0 || this.velocity.orbitY !== 0)) {
        this.velocity = { orbitX: 0, orbitY: 0 }; this.invalidate();
      }
      const factor = reducedMotion ? 1 : 1 - Math.exp(-10 * dt);
      const nextDistance = this.distanceM + (this.desiredDistanceM - this.distanceM) * factor;
      if (Math.abs(nextDistance - this.distanceM) > 1e-4) {
        this.distanceM = nextDistance; this.pitchRad = this.safePitch(this.pitchRad); this.invalidate();
      }
    }
    this.engineFrameMs = performance.now() - start;
  }

  getLastCommandResult(): CommandResult | null { return this.lastCommandResult; }
  dispose(): void { this.fly = null; this.trackingId = null; this.poseCache = null; this.footprintCache = null; this.disposed = true; }

  private safePitch(rad: number): number {
    return clamp(rad, 0, Math.min(MAX_TILT_RAD, Math.acos(clamp(MIN_CLEARANCE_M / this.distanceM, 0, 1))));
  }

  private poseAtDistance(distanceM: number): CameraPose {
    const axes = poseFor(this.target, distanceM, this.headingRad, this.pitchRad);
    return { ...axes, verticalFovRad: this.verticalFovRad, viewportCss: this.viewportCss,
      nearM: 0.5, farM: MAX_DISTANCE_M + 2 * WGS84_A_M,
      originEpoch: this.origin.originEpoch, revision: this.revision };
  }
}

function validateViewport(viewport: Viewport): Viewport {
  if (!finite(viewport.width, viewport.height) || viewport.width < 1 || viewport.height < 1) {
    throw new RangeError("Viewport must be positive and finite");
  }
  return { width: viewport.width, height: viewport.height };
}
