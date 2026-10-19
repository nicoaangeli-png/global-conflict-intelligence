import { beforeEach, describe, expect, it, vi } from "vitest";

const layers = vi.hoisted(() => ({
  loadLayer: vi.fn(),
  listLayers: vi.fn(),
}));

vi.mock("@/server/layers", () => ({
  isLayerId: (id: string) => id === "nuclear_plants",
  loadLayer: layers.loadLayer,
  listLayers: layers.listLayers,
}));

import { GET } from "@/app/api/layers/route";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/layers", () => {
  it("refuse un id inconnu sans appeler de source", async () => {
    const response = await GET(new Request("http://localhost/api/layers?id=unknown"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "id must be a known LayerId" });
  });

  it("retourne le contrat LayerResponse pour un calque connu", async () => {
    layers.loadLayer.mockResolvedValue({ layerId: "nuclear_plants", status: "ok", features: [{ countries: ["FRA"] }] });
    const response = await GET(new Request("http://localhost/api/layers?id=nuclear_plants"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ layerId: "nuclear_plants", status: "ok", features: [{ countries: ["FRA"] }] });
  });

  it("liste les métadonnées et le nombre sans les features", async () => {
    layers.listLayers.mockResolvedValue([{ layerId: "nuclear_plants", title: "Centrales nucléaires", sourceName: "Wikidata", asOf: null, itemCount: 374 }]);
    const response = await GET(new Request("http://localhost/api/layers"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ layers: [{ layerId: "nuclear_plants", title: "Centrales nucléaires", sourceName: "Wikidata", asOf: null, itemCount: 374 }] });
    expect(body.layers[0]).not.toHaveProperty("features");
  });
});
