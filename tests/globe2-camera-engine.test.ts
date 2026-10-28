import { describe, expect, it } from "vitest";
import { Group, PerspectiveCamera } from "three";
import { CameraEngine, groundAtNdc, moveAnchor, slerpAnchor } from "@/lib/globe2/camera";
import { applyCameraToThree } from "@/components/globe2/CameraThreeAdapter";
import { bboxContains, chordDistanceMeters, toEcef, WGS84_A_M } from "@/lib/globe2/geo";

const T = 1_000_000;
const finiteState = (engine: CameraEngine) => {
  const s = engine.getState(), p = engine.getPose();
  expect([s.eye.latDeg, s.eye.lonDeg, s.eye.heightM, s.target.latDeg, s.target.lonDeg,
    s.distanceM, s.headingRad, s.pitchRad, p.nearM, p.farM,
    p.eyeEcef.x, p.eyeEcef.y, p.eyeEcef.z].every(Number.isFinite)).toBe(true);
  expect(s.eye.heightM).toBeGreaterThanOrEqual(75);
};

describe("ORBITAL Camera Engine without WebGL", () => {
  it("creates a finite canonical state and stable view revision", () => {
    const engine = new CameraEngine();
    const state = engine.getState();
    expect(state.mode).toBe("orbit");
    expect(state.target.datum).toBe("WGS84");
    expect(state.eye.heightM).toBeGreaterThan(1_000_000);
    expect(state.revision).toBe(0);
    expect(engine.getPose()).toBe(engine.getPose());
    finiteState(engine);
  });

  it("orbits, pans and continues inertia only after a gesture", () => {
    const engine = new CameraEngine();
    const before = engine.getState().target;
    engine.beginGesture(T);
    engine.orbit(80, 20, T);
    const moved = engine.getState().target;
    expect(moved.lonDeg).not.toBe(before.lonDeg);
    engine.step(1 / 60, T + 16);
    expect(engine.getState().target).toEqual(moved);
    engine.endGesture();
    engine.step(1 / 60, T + 32);
    expect(engine.getState().target).not.toEqual(moved);
    engine.pan(20, -10, T + 40);
    finiteState(engine);
  });

  it("zooms around a surface pointer, bounds distance and maintains ellipsoid clearance", () => {
    const engine = new CameraEngine();
    engine.flyTo({ target: { latDeg: 48.8566, lonDeg: 2.3522 }, distanceM: 3000 }, T, true);
    const previous = engine.getState().target;
    engine.zoomAtPointer(0.5, 0.35, 0.2, T + 1);
    expect(engine.getState().target).not.toEqual(previous);
    for (let i = 0; i < 50; i++) engine.zoomBy(0.1, T + i + 2);
    engine.step(1, T + 100, true);
    expect(engine.getState().distanceM).toBe(120);
    engine.tilt(Math.PI / 2, T + 101);
    finiteState(engine);
    expect(engine.getState().pitchRad).toBeLessThan(Math.PI / 2);
  });

  it("restores north-up, reset and switches modes without changing the production camera", () => {
    const engine = new CameraEngine();
    engine.flyTo({ target: { latDeg: 45, lonDeg: 8 }, distanceM: 5000, headingRad: 1,
      pitchRad: 0.5 }, T, true);
    expect(engine.getState().headingRad).toBe(1);
    engine.northUp(T + 1);
    expect(engine.getState().headingRad).toBe(0);
    engine.setMode("surface", T + 2);
    expect(engine.getState().mode).toBe("surface");
    engine.reset(T + 3);
    expect(engine.getState().mode).toBe("orbit");
    expect(engine.getState().distanceM).toBe(20_000_000);
  });

  it("flies by a bounded great-circle arc through the antimeridian and antipodes", () => {
    const engine = new CameraEngine();
    engine.flyTo({ target: { latDeg: 0, lonDeg: 179.5 }, distanceM: 2_000_000 }, T, true);
    engine.flyTo({ target: { latDeg: 0, lonDeg: -179.5 }, distanceM: 1_000_000,
      durationMs: 1000, id: "seam" }, T + 1);
    engine.step(0.016, T + 501);
    expect(Math.abs(engine.getState().target.lonDeg)).toBeGreaterThan(179);
    engine.step(0.016, T + 1001);
    expect(engine.getState().target.lonDeg).toBeCloseTo(-179.5, 4);
    const halfway = slerpAnchor({ latDeg: 0, lonDeg: 0 }, { latDeg: 0, lonDeg: -180 }, 0.5);
    expect([halfway.latDeg, halfway.lonDeg].every(Number.isFinite)).toBe(true);
    expect(slerpAnchor({ latDeg: 0, lonDeg: 0 }, { latDeg: 0, lonDeg: -180 }, 1).lonDeg).toBe(-180);
  });

  it("cancels a fly-to on user input and rejects older automation commands", () => {
    const engine = new CameraEngine();
    engine.flyTo({ target: { latDeg: 48, lonDeg: 2 }, distanceM: 1000, id: "first" }, T);
    expect(engine.getState().activeCommandId).toBe("first");
    engine.orbit(10, 0, T + 200);
    expect(engine.getState().activeCommandId).toBeNull();
    expect(engine.getLastCommandResult()).toEqual({ id: "first", status: "cancelled", reason: "user-interaction" });
    const old = engine.dispatch({ id: "old", source: "aura", action: "focus",
      issuedAt: new Date(T).toISOString(), payload: { target: { id: "paris", position: { latDeg: 48, lonDeg: 2 } } } }, T + 300);
    expect(old.status).toBe("cancelled");
    expect(engine.getState().activeCommandId).toBeNull();
  });

  it("supersedes concurrent commands and tracks a synthetic target", () => {
    const engine = new CameraEngine();
    engine.flyTo({ target: { latDeg: 48, lonDeg: 2 }, distanceM: 100_000, id: "first" }, T);
    engine.flyTo({ target: { latDeg: 46, lonDeg: 7 }, distanceM: 200_000, id: "second" }, T + 1);
    expect(engine.getState().activeCommandId).toBe("second");
    engine.step(0.016, T + 2000);
    expect(engine.getLastCommandResult()?.status).toBe("completed");
    const track = engine.dispatch({ id: "track", source: "user", action: "track",
      issuedAt: new Date(T + 2001).toISOString(),
      payload: { target: { kind: "mobile", id: "synthetic" }, enabled: true } }, T + 2001);
    expect(track.status).toBe("completed");
    engine.updateTrackedTarget("synthetic", { latDeg: 47, lonDeg: 8 });
    expect(engine.getState().target.latDeg).toBe(47);
    engine.pan(1, 1, T + 2002);
    expect(engine.getState().trackingId).toBeNull();
  });

  it("fits a typed area target and rejects malformed fit commands", () => {
    const engine = new CameraEngine();
    const fit = engine.dispatch({ id: "fit-france", source: "feed", action: "flyTo",
      issuedAt: new Date(T).toISOString(), payload: {
        target: { id: "france", position: { latDeg: 46.6, lonDeg: 2.2 }, radiusM: 500_000 },
        framing: "fit", distanceM: 1000,
      } }, T, true);
    expect(fit.status).toBe("completed");
    expect(engine.getState().distanceM).toBeGreaterThan(1_000_000);
    const failed = engine.dispatch({ id: "bad-fit", source: "feed", action: "flyTo",
      issuedAt: new Date(T + 1).toISOString(), payload: {
        target: { id: "bad", position: { latDeg: 46, lonDeg: 2 } }, framing: "fit", distanceM: 1000,
      } }, T + 1);
    expect(failed.status).toBe("failed");
  });

  it("handles poles, resize, FOV and invalid inputs", () => {
    const engine = new CameraEngine();
    engine.flyTo({ target: { latDeg: 89.9, lonDeg: 179 }, distanceM: 5000 }, T, true);
    engine.orbit(200, 100, T + 1);
    finiteState(engine);
    engine.setViewport({ width: 390, height: 844 });
    engine.setVerticalFov(65 * Math.PI / 180);
    expect(engine.getState().viewportCss).toEqual({ width: 390, height: 844 });
    expect(engine.getPose().verticalFovRad).toBeCloseTo(65 * Math.PI / 180);
    expect(() => engine.setViewport({ width: 0, height: 100 })).toThrow(RangeError);
    expect(() => engine.setVerticalFov(Infinity)).toThrow(RangeError);
    expect(() => engine.zoomBy(NaN)).toThrow(RangeError);
    expect(() => engine.orbit(Infinity, 0)).toThrow(RangeError);
    expect(() => engine.flyTo({ target: { latDeg: 91, lonDeg: 0 }, distanceM: 1000 })).toThrow(RangeError);
    expect(() => engine.step(NaN)).toThrow(RangeError);
    expect(moveAnchor({ latDeg: 45, lonDeg: 20 }, 0, 0).latDeg).toBeCloseTo(45, 10);
  });

  it("computes footprint, horizon and dynamic near/far at space and city", () => {
    const engine = new CameraEngine();
    const space = engine.getViewFootprint();
    expect(space.center).not.toBeNull();
    expect(space.partial).toBe(true);
    expect(space.horizonVisible).toBe(true);
    expect(space.spans.length).toBeGreaterThan(0);
    expect(space.groundSpanM).toBeGreaterThan(1_000_000);
    engine.flyTo({ target: { latDeg: 48.8566, lonDeg: 2.3522 }, distanceM: 30_000 }, T, true);
    const city = engine.getViewFootprint();
    expect(city.partial).toBe(false);
    expect(city.center?.latDeg).toBeCloseTo(48.8566, 3);
    expect(city.groundSpanM).toBeLessThan(space.groundSpanM!);
    expect(city.revision).toBe(engine.getState().revision);
    expect(city.spans.some(b => bboxContains(b, 48.8566, 2.3522))).toBe(true);
    expect(engine.getPose().nearM).toBeLessThan(engine.getPose().farM);
    expect(groundAtNdc(engine.getPose(), 0, 0)).not.toBeNull();
    engine.tilt(75 * Math.PI / 180, T + 1);
    const oblique = engine.getViewFootprint();
    expect(oblique.partial).toBe(true);
    expect(oblique.groundSpanM).toBeGreaterThan(0);
    engine.flyTo({ target: { latDeg: 0, lonDeg: 179.8 }, distanceM: 300_000 }, T + 2, true);
    expect(engine.getViewFootprint().crossesAntimeridian).toBe(true);
  });

  it("rebases atomically and preserves the target in double precision", () => {
    const engine = new CameraEngine();
    const first = engine.getState().originEpoch;
    engine.flyTo({ target: { latDeg: 48, lonDeg: 2 }, distanceM: 2000 }, T, true);
    const state = engine.getState();
    expect(state.originEpoch).toBeGreaterThan(first);
    expect(state.rebaseCount).toBeGreaterThan(0);
    expect(chordDistanceMeters(engine.getPose().targetEcef, toEcef(state.target))).toBeLessThan(0.01);
  });

  it("honors reduced motion and disposes cleanly", () => {
    const engine = new CameraEngine();
    engine.flyTo({ target: { latDeg: 30, lonDeg: 40 }, distanceM: 10_000,
      durationMs: 5000 }, T, true);
    expect(engine.getState().activeCommandId).toBeNull();
    expect(engine.getState().target.latDeg).toBe(30);
    engine.dispose();
    expect(() => engine.getState()).toThrow("disposed");
  });

  it("copies a pose into Three.js without letting Three own engine state", () => {
    const engine = new CameraEngine();
    const camera = new PerspectiveCamera(); const globe = new Group();
    applyCameraToThree(engine, camera, globe);
    expect(camera.fov).toBeCloseTo(50);
    expect(camera.far).toBeGreaterThan(WGS84_A_M);
    expect(globe.position.length()).toBeGreaterThan(0);
    expect(engine.getState().revision).toBe(0);
  });
});
