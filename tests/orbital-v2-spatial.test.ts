import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ConflictLayer } from "@/components/conflicts/ConflictLayer";
import { FeedLayer } from "@/components/globe/FeedLayer";
import { MobileLayer } from "@/components/globe/MobileLayer";
import { CameraLayer } from "@/components/globe/CameraLayer";
import { OrbitalNavigation } from "@/components/globe2/integration/OrbitalNavigation";
import { WGS84_SURFACE, renderOffsetMeters } from "@/components/globe2/integration/Wgs84RenderSurface";
import { signalColor } from "@/components/globe2/integration/signalColor";
import { THEME_COLORS } from "@/components/feeds/feedModel";
import { STARFIELD } from "@/lib/config/visual";
import { latLonToVector3 } from "@/lib/geo/latlon";
import { toEcef, WGS84_A_M } from "@/lib/globe2/geo";
import { viewScale } from "@/lib/globe2/viewScale";
import type { LiveItem } from "@/types/feeds";
import type { CameraMarker } from "@/types/cameras";
import type { ConflictCluster } from "@/types/conflict";
import { CLUSTER, FEED_ITEMS } from "./e2e/fixtures";

const feed = (id = "test:front"): LiveItem => ({ ...FEED_ITEMS[0], id, lat: 45, lon: 2 } as LiveItem);
function view(group: THREE.Group) {
  const nav = new OrbitalNavigation();
  nav.resize(900, 900, 34);
  nav.engine.flyTo({ target: { latDeg: 45, lonDeg: 2 }, distanceM: 2_000_000, durationMs: 0 });
  const camera = new THREE.PerspectiveCamera();
  nav.applyTo(camera, group);
  group.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  return { nav, camera };
}

describe("V1 layers on ORBITAL V2 spatial runtime", () => {
  it("keeps the default V1 projection and uses Geo Core only when injected", () => {
    const legacy = new FeedLayer(1); legacy.setItems([feed()]);
    const points = legacy.group.children[0] as THREE.Points;
    const expectedLegacy = latLonToVector3(45, 2, 1.012);
    expect(Array.from(points.geometry.getAttribute("position").array)).toEqual(expectedLegacy.toArray().map(Math.fround));
    const projected = WGS84_SURFACE.point(45, 2, 1.012);
    const ecef = toEcef({ latDeg: 45, lonDeg: 2, heightM: renderOffsetMeters(1.012), datum: "WGS84" });
    expect(projected.toArray()).toEqual([ecef.x / WGS84_A_M, ecef.z / WGS84_A_M, -ecef.y / WGS84_A_M]);
    legacy.dispose();
  });

  it("preserves conflict picking/selection across a real floating-origin rebase", () => {
    const layer = new ConflictLayer(1, WGS84_SURFACE);
    const cluster: ConflictCluster = { ...CLUSTER, latitude: 45, longitude: 2,
      topType: "Battles", confidence: "MEDIA_SIGNAL", geoPrecision: "city" };
    layer.setClusters([cluster]); layer.setSelected(cluster.id, null);
    const { nav, camera } = view(layer.group);
    expect(nav.engine.getState().originEpoch).toBeGreaterThan(0);
    expect(camera.far).toBeGreaterThan(STARFIELD.outerRadius + 4.2);
    expect(layer.hitTest(camera, new THREE.Vector2(), 900, 900)?.id).toBe(cluster.id);
    nav.engine.flyTo({ target: { latDeg: 45, lonDeg: 2 }, distanceM: 2_000, durationMs: 0 });
    nav.applyTo(camera, layer.group); camera.updateMatrixWorld(true);
    expect(layer.hitTest(camera, new THREE.Vector2(), 900, 900)?.id).toBe(cluster.id);
    layer.dispose(); nav.dispose();
  });

  it("picks the real FeedLayer and rejects the opposite hemisphere", () => {
    const layer = new FeedLayer(1, WGS84_SURFACE);
    layer.setItems([feed(), { ...feed("test:back"), lat: -45, lon: -178 }]);
    const { nav, camera } = view(layer.group);
    expect(layer.hitTest(camera, new THREE.Vector2(), 900, 900)?.id).toBe("test:front");
    expect(WGS84_SURFACE.visible(WGS84_SURFACE.point(-45, -178), WGS84_SURFACE.point(45, 2).multiplyScalar(2))).toBe(false);
    layer.dispose(); nav.dispose();
  });

  it("keeps aircraft, warship and merchant silhouettes, heading and observed tracks", () => {
    const layer = new MobileLayer(1, WGS84_SURFACE);
    layer.setItems([
      { ...feed("air"), category: "military", vehicle: "aircraft", track: [{ lat: 44, lon: 1, at: "2026-10-01T00:00:00Z" }] },
      { ...feed("warship"), category: "military", vehicle: "vessel" },
      { ...feed("merchant"), category: "shipping", vehicle: "vessel" },
    ]);
    const points = layer.group.children[1] as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(points.material.fragmentShader).toContain("plane(q)");
    expect(points.material.fragmentShader).toContain("warship(q)");
    expect(points.material.fragmentShader).toContain("cargo(q)");
    expect(Array.from(points.geometry.getAttribute("aKind").array)).toEqual([2, 1, 0]);
    expect((layer.group.children[0] as THREE.LineSegments).geometry.getAttribute("position").count).toBeGreaterThan(2);
    const { nav, camera } = view(layer.group);
    layer.update(1, 900, 900, performance.now() + 60_000);
    expect(layer.hitTest(camera, new THREE.Vector2(), 900, 900)).not.toBeNull();
    layer.dispose(); nav.dispose();
  });

  it("preserves camera aggregation and direct picking without media in the render layer", () => {
    const layer = new CameraLayer(1, WGS84_SURFACE);
    const cameraItem = { id: "test:camera", latitude: 45, longitude: 2, mediaType: "periodic_snapshot" } as CameraMarker;
    layer.setCameras([cameraItem], 2.4, cameraItem.id);
    const { nav, camera } = view(layer.group);
    const localCamera = layer.group.worldToLocal(camera.getWorldPosition(new THREE.Vector3()));
    expect(layer.hitTest(camera, new THREE.Vector2(), 900, 900, layer.group.matrixWorld, localCamera)?.id).toBe(cameraItem.id);
    layer.dispose(); nav.dispose();
  });

  it("shows individual cameras at local semantic scales without changing API clustering", () => {
    const layer = new CameraLayer(1, WGS84_SURFACE);
    const a = { id: "a", latitude: 45, longitude: 2, mediaType: "periodic_snapshot" } as CameraMarker;
    layer.setCameras([a, { ...a, id: "b", latitude: 45.01 }], 2.4, null);
    const points = layer.group.children[0] as THREE.Points;
    expect(points.geometry.getAttribute("position").count).toBe(1);
    layer.setViewDegrees(0);
    expect(points.geometry.getAttribute("position").count).toBe(2);
    layer.setViewDegrees(8); layer.setCameras([a, { ...a, id: "b", latitude: 45.01 }], 2.4, "b");
    expect(points.geometry.getAttribute("position").count).toBe(2);
    layer.dispose();
  });

  it("adapts central focus, interruption, local zoom and derived semantic scale", () => {
    const nav = new OrbitalNavigation();
    nav.resize(1440, 900, 34); nav.focus(48.8566, 2.3522, 1000);
    expect(nav.engine.getState().activeCommandId).toBe("store-focus-1000");
    nav.beginDrag(1100); nav.drag(10, 4, 1100);
    expect(nav.engine.getState().activeCommandId).toBeNull();
    nav.dragging = false;
    nav.engine.flyTo({ target: { latDeg: 48.8566, lonDeg: 2.3522 }, distanceM: 2_000, durationMs: 0 });
    expect(nav.groundAt(0, 0)?.lat).toBeCloseTo(48.8566, 6);
    expect(viewScale(nav.engine.getState(), nav.engine.getViewFootprint())).toBe("DISTRICT");
    nav.dispose();
  });

  it("keeps every cluster and its provenance while reserving the original red palette for violence", () => {
    const violent: ConflictCluster = { ...CLUSTER, topType: "Battles", confidence: "MEDIA_SIGNAL", geoPrecision: "city" };
    const protest = Object.freeze({ ...violent, id: "protest", topType: "Protests" as const });
    const layer = new ConflictLayer(1, WGS84_SURFACE, signalColor);
    layer.setClusters([violent, protest]);
    expect(signalColor(violent)).toBeNull();
    expect(signalColor(protest)).toBe(THEME_COLORS.social);
    const marker = layer.group.children[2] as THREE.Mesh;
    const tint = marker.geometry.getAttribute("aSignalTint");
    expect(tint.count).toBe(8); expect(tint.getW(0)).toBe(0); expect(tint.getW(4)).toBe(1);
    expect(marker.geometry.getAttribute("aReal").getX(4)).toBe(1);
    expect(protest.confidence).toBe("MEDIA_SIGNAL");
    layer.dispose();
  });

  it("uses hysteresis and accounts for FOV and viewport instead of altitude alone", () => {
    const nav = new OrbitalNavigation(); nav.resize(900, 900, 34);
    nav.engine.flyTo({ target: { latDeg: 0, lonDeg: 0 }, distanceM: 30_000, durationMs: 0 });
    const state = nav.engine.getState();
    const footprint = { ...nav.engine.getViewFootprint(), groundSpanM: 13_000, horizonVisible: false };
    expect(viewScale(state, footprint, "CITY")).toBe("CITY");
    const wide = { ...state, viewportCss: { width: 3600, height: 900 }, verticalFovRad: Math.PI / 2 };
    expect(viewScale(wide, footprint)).not.toBe(viewScale(state, footprint));
    nav.dispose();
  });
});
