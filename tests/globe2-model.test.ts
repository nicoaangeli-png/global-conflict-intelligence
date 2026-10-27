import { describe, expect, it } from "vitest";
import { Cartesian3, Ellipsoid, Math as CesiumMath } from "cesium";
import { LAB_MOBILES, bboxFromCoordinates, catalogForViewport, contains, screenRotation, semanticLevel, syntheticOrbit, syntheticPoint, validBbox } from "@/lib/lab/globe2/model";
import { terrainForMode } from "@/lib/lab/globe2/terrain";
import * as Cesium from "cesium";
import { GET } from "@/app/api/lab/globe2/catalog/route";

describe("isolated Cesium Globe 2.0 laboratory", () => {
  it("preserves WGS84 latitude and longitude through Cesium Cartesian mapping", () => {
    const coordinate = Cartesian3.fromDegrees(2.3522, 48.8566, 1234);
    const mapped = Ellipsoid.WGS84.cartesianToCartographic(coordinate);
    expect(CesiumMath.toDegrees(mapped.longitude)).toBeCloseTo(2.3522, 5);
    expect(CesiumMath.toDegrees(mapped.latitude)).toBeCloseTo(48.8566, 5);
    expect(mapped.height).toBeCloseTo(1234, 2);
  });

  it("uses both height and footprint and hysteresis at semantic boundaries", () => {
    expect(semanticLevel(25_000_000, 60, 900, 180, null)).toBe("PLANET");
    expect(semanticLevel(2_000, 60, 900, 0.01, null)).toBe("DISTRICT");
    expect(semanticLevel(9_800_000, 60, 900, 1, "PLANET")).toBe("PLANET");
    expect(semanticLevel(7_000_000, 60, 900, 1, "PLANET")).toBe("CONTINENT");
    expect(semanticLevel(10_500_000, 60, 900, 1, "CONTINENT")).toBe("CONTINENT");
    expect(semanticLevel(12_000_000, 60, 900, 1, "CONTINENT")).toBe("PLANET");
  });

  it("handles antimeridian bbox and rejects invalid extents", () => {
    const wrap = { west: 170, south: -20, east: -170, north: 20 };
    expect(validBbox(wrap)).toBe(true);
    expect(contains(wrap, 0, 179)).toBe(true);
    expect(contains(wrap, 0, -179)).toBe(true);
    expect(contains(wrap, 0, 0)).toBe(false);
    expect(validBbox({ ...wrap, north: -30 })).toBe(false);
    expect(validBbox({ ...wrap, west: Number.NaN })).toBe(false);
    const sampled = bboxFromCoordinates([{ latitude: 10, longitude: 179 }, { latitude: 12, longitude: -179 }]);
    expect(sampled).not.toBeNull();
    expect(validBbox(sampled!)).toBe(true);
    expect(contains(sampled!, 11, 179)).toBe(true);
    expect(contains(sampled!, 11, -179)).toBe(true);
  });

  it("keeps 20,000 cameras and 15,000 satellites server-side and bounds responses", () => {
    const world = { west: -180, south: -90, east: 180, north: 90 };
    const planet = catalogForViewport(world, "PLANET", true, true);
    expect(planet.total).toBe(35_000);
    expect(planet.candidates).toBe(35_000);
    expect(planet.points.length).toBeLessThan(300);
    expect(planet.points.some((point) => point.count > 1)).toBe(true);
    const city = catalogForViewport({ west: 2, south: 48, east: 3, north: 49 }, "CITY", true, true);
    expect(city.points.length).toBeLessThanOrEqual(1200);
    expect(city.candidates).toBeLessThan(35_000);
    expect(city.points.every((point) => point.count === 1)).toBe(true);
    const dense = catalogForViewport(world, "CITY", true, true);
    expect(dense.points.filter((point) => point.kind === "camera")).toHaveLength(600);
    expect(dense.points.filter((point) => point.kind === "satellite")).toHaveLength(600);
    expect(planet.points[0]).not.toHaveProperty("imageUrl");
    expect(planet.points[0]).not.toHaveProperty("streamUrl");
  });

  it("keeps airplane, military ship and merchant silhouettes as distinct kinds", () => {
    expect(LAB_MOBILES.map((mobile) => mobile.kind)).toEqual(["aircraft", "warship", "merchant"]);
    expect(LAB_MOBILES.every((mobile) => Number.isFinite(mobile.heading))).toBe(true);
    expect(syntheticPoint("camera", 99)).toEqual(syntheticPoint("camera", 99));
    expect(screenRotation(0, -10, false)).toBeCloseTo(0);
    expect(screenRotation(10, 0, false)).toBeCloseTo(-Math.PI / 2);
    expect(screenRotation(10, 0, true)).toBeCloseTo(0);
  });

  it("shows individual regional satellites and an orbit only for a selected satellite", () => {
    const region = catalogForViewport({ west: 0, south: 45, east: 5, north: 52 }, "COUNTRY", false, true);
    expect(region.points.some((point) => point.id === "satellite:0")).toBe(true);
    const orbit = syntheticOrbit(syntheticPoint("satellite", 0));
    expect(orbit).toHaveLength(121);
    expect(orbit[0].latitude).toBeCloseTo(49.2);
    expect(syntheticOrbit(syntheticPoint("camera", 0))).toEqual([]);
  });

  it("provides an offline terrain default and fallback when open terrain fails", async () => {
    const local = await terrainForMode("ellipsoid", Cesium);
    expect(local.provider).toBeInstanceOf(Cesium.EllipsoidTerrainProvider);
    expect(local.fallback).toBe(false);
    const fallback = await terrainForMode("open", Cesium, async () => { throw new Error("offline"); });
    expect(fallback.provider).toBeInstanceOf(Cesium.EllipsoidTerrainProvider);
    expect(fallback.fallback).toBe(true);
  });

  it("rejects bad API bboxes and never returns media URLs", async () => {
    const invalid = GET(new Request("http://localhost/api/lab/globe2/catalog?bbox=0,91,1,92&level=PLANET"));
    expect(invalid.status).toBe(400);
    expect(GET(new Request("http://localhost/api/lab/globe2/catalog?bbox=0,,1,2&level=PLANET")).status).toBe(400);
    const valid = GET(new Request("http://localhost/api/lab/globe2/catalog?bbox=-180,-90,180,90&level=PLANET&cameras=1&satellites=1"));
    expect(valid.status).toBe(200);
    const json = await valid.json() as { points: Array<Record<string, unknown>>; synthetic: boolean; total: number };
    expect(json.synthetic).toBe(true);
    expect(json.total).toBe(35_000);
    expect(JSON.stringify(json)).not.toMatch(/imageUrl|streamUrl|sourceUrl/);
  });
});
