import { describe, expect, it } from "vitest";
import { GlobeCameraController } from "@/components/globe/GlobeCamera";
import { CAMERA } from "@/lib/config/visual";

const T0 = 1_000_000;

describe("caméra orbitale du globe (sans WebGL)", () => {
  it("part de la vue initiale et y revient", () => {
    const camera = new GlobeCameraController(CAMERA, T0);
    expect(camera.targetDistance).toBe(CAMERA.initial.distance);
    camera.zoomBy(0.5, T0);
    camera.drag(40, 10, T0);
    camera.reset(T0 + 1);
    expect([camera.targetDistance, camera.targetTheta, camera.targetPhi]).toEqual([CAMERA.initial.distance, CAMERA.initial.theta, CAMERA.initial.phi]);
    expect(camera.velocity).toEqual({ theta: 0, phi: 0 });
  });

  it("borne le zoom et l'inclinaison", () => {
    const camera = new GlobeCameraController(CAMERA, T0);
    for (let i = 0; i < 50; i++) camera.zoomBy(0.5, T0);
    expect(camera.targetDistance).toBe(CAMERA.minDistance);
    for (let i = 0; i < 50; i++) camera.zoomBy(2, T0);
    expect(camera.targetDistance).toBe(CAMERA.maxDistance);
    camera.drag(0, -100_000, T0);
    expect(camera.targetPhi).toBeCloseTo(Math.PI - 0.15);
  });

  it("molette : zoom ; balayage horizontal du trackpad : rotation sans zoom ; ctrl : pincement", () => {
    const camera = new GlobeCameraController(CAMERA, T0);
    const start = camera.targetDistance;
    camera.wheel({ deltaX: 0, deltaY: 100, ctrlKey: false }, T0);
    expect(camera.targetDistance).toBeCloseTo(start * Math.exp(60 * 0.0016)); // delta borné à 60
    const distance = camera.targetDistance;
    const theta = camera.targetTheta;
    camera.wheel({ deltaX: 50, deltaY: 5, ctrlKey: false }, T0);
    expect(camera.targetDistance).toBe(distance);
    expect(camera.targetTheta).toBeCloseTo(theta - 50 * 0.0022);
    camera.wheel({ deltaX: 0, deltaY: -20, ctrlKey: true }, T0);
    expect(camera.targetDistance).toBeCloseTo(distance * Math.exp(-20 * 0.005));
  });

  it("pincement : écart doublé = distance divisée par deux (dans les bornes)", () => {
    const camera = new GlobeCameraController(CAMERA, T0);
    const start = camera.targetDistance;
    camera.pinch(100, 200, T0);
    expect(camera.targetDistance).toBeCloseTo(Math.max(CAMERA.minDistance, start / 2));
  });

  it("inertie après glissé, puis rotation automatique seulement après 25 s d'inactivité", () => {
    const camera = new GlobeCameraController(CAMERA, T0);
    camera.beginDrag(T0);
    camera.drag(30, 0, T0);
    camera.dragging = false;
    const afterDrag = camera.targetTheta;
    camera.step(1 / 60, { reducedMotion: false, now: T0 + 16 });
    expect(camera.targetTheta).toBeLessThan(afterDrag); // l'élan continue dans le même sens
    camera.stop();
    const still = camera.targetTheta;
    camera.step(1 / 60, { reducedMotion: false, now: T0 + 10_000 });
    expect(camera.targetTheta).toBe(still);
    camera.step(1 / 60, { reducedMotion: false, now: T0 + 26_000 });
    expect(camera.targetTheta).toBeGreaterThan(still);
  });

  it("mouvement réduit : ni inertie ni rotation automatique, position atteinte immédiatement", () => {
    const camera = new GlobeCameraController(CAMERA, T0);
    camera.zoomBy(0.8, T0);
    camera.velocity = { theta: 1, phi: 0 };
    const theta = camera.targetTheta;
    camera.step(1 / 60, { reducedMotion: true, now: T0 + 60_000 });
    expect(camera.targetTheta).toBe(theta);
    expect(camera.distance).toBe(camera.targetDistance);
  });

  it("recentrage par le plus court chemin, zoom conservé", () => {
    const camera = new GlobeCameraController(CAMERA, T0);
    camera.zoomBy(0.6, T0);
    const distance = camera.targetDistance;
    camera.focus(48.85, 2.35, T0);
    expect(Math.abs(camera.targetTheta - camera.theta)).toBeLessThanOrEqual(Math.PI);
    expect(camera.targetDistance).toBe(distance);
  });
});
