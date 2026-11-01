import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ProductSignalLayer } from "@/components/globe2/ProductSignalLayer";
import type { ConflictCluster } from "@/types/conflict";
import type { LiveItem } from "@/types/feeds";

const cluster = (latitude: number, longitude: number, id: string): ConflictCluster => ({
  id, latitude, longitude, country: "Test", region: "", locality: "", eventCount: 1,
  fatalities: 0, intensity: 0.6, typeCounts: { Battles: 1 }, topType: "Battles",
  confidence: "MEDIA_SIGNAL", confidenceCounts: { MEDIA_SIGNAL: 1 },
  firstEventAt: "2026-01-01T00:00:00Z", lastEventAt: "2026-01-01T00:00:00Z",
  eventIds: [], realShare: 1,
});

const feed = (latitude: number, longitude: number, id: string): LiveItem => ({
  id, lat: latitude, lon: longitude, category: "disaster", nature: "sensor_measurement",
  title: "Mesure test", summary: null, url: null, sourceId: "fixture", sourceName: "Fixture",
  publishedAt: "2026-01-01T00:00:00Z", occurredAt: null, fetchedAt: "2026-01-01T00:00:00Z",
  countries: [], severity: null, metric: null, caveat: "TEST UNIQUEMENT",
});

function view(layer: ProductSignalLayer) {
  // Non-zero translation models an atomic floating-origin rebase.
  layer.group.position.set(-1_000_000, 200_000, 300_000);
  layer.group.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 90_000_000);
  camera.position.set(layer.group.position.x + 20_000_000, layer.group.position.y, layer.group.position.z);
  camera.lookAt(layer.group.position); camera.updateMatrixWorld(true);
  return camera;
}

describe("Globe2 direct signal picking", () => {
  it("selects a front-side conflict using its WGS84/ECEF position after rebase", () => {
    const layer = new ProductSignalLayer(THREE, 1);
    layer.setData([cluster(0, 0, "front"), cluster(0, -180, "back")], []);
    const hit = layer.hitTest(view(layer), new THREE.Vector2(0, 0), 900, 900);
    expect(hit?.kind).toBe("conflict");
    if (hit?.kind === "conflict") expect(hit.cluster.id).toBe("front");
    layer.dispose();
  });

  it("selects a front-side feed and rejects the far hemisphere", () => {
    const layer = new ProductSignalLayer(THREE, 1);
    layer.setData([], [feed(0, 0, "front"), feed(0, -180, "back")]);
    const camera = view(layer);
    const hit = layer.hitTest(camera, new THREE.Vector2(0, 0), 900, 900);
    expect(hit?.kind).toBe("feed");
    if (hit?.kind === "feed") expect(hit.item.id).toBe("front");
    expect(layer.hitTest(camera, new THREE.Vector2(0.95, 0.95), 900, 900)).toBeNull();
    layer.dispose();
  });

  it("picks a non-violent event without promoting it to a conflict marker", () => {
    const layer = new ProductSignalLayer(THREE, 1);
    layer.setData([], [], [{ ...cluster(0, 0, "protest"), topType: "Protests" }]);
    const hit = layer.hitTest(view(layer), new THREE.Vector2(0, 0), 900, 900);
    expect(hit?.kind).toBe("event");
    layer.dispose();
  });
});
