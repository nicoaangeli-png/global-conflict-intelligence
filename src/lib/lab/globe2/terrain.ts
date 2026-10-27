import type { CesiumTerrainProvider, EllipsoidTerrainProvider } from "cesium";

export type TerrainMode = "ellipsoid" | "open";
export const OPEN_TERRAIN_URL = "https://terrain.reearth.land/cesium-mesh/ellipsoid";

/** No ion token and no mandatory network dependency. */
export async function terrainForMode(
  mode: TerrainMode,
  cesium: typeof import("cesium"),
  load: (url: string) => Promise<CesiumTerrainProvider> = (url) => cesium.CesiumTerrainProvider.fromUrl(url, { requestVertexNormals: true }),
): Promise<{ provider: CesiumTerrainProvider | EllipsoidTerrainProvider; fallback: boolean }> {
  if (mode === "ellipsoid") return { provider: new cesium.EllipsoidTerrainProvider(), fallback: false };
  try { return { provider: await load(OPEN_TERRAIN_URL), fallback: false }; }
  catch { return { provider: new cesium.EllipsoidTerrainProvider(), fallback: true }; }
}
