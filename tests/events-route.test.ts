import { describe, expect, it, vi } from "vitest";

const ids = (n: number) => Array.from({ length: n }, (_, index) => `evt-${index}`);
vi.mock("@/server/intel", () => ({
  queryClusters: async () => ({ generatedAt: "x", clusters: [{ id: "grand", eventIds: ids(900), eventCount: 900 }, { id: "petit", eventIds: ids(3), eventCount: 3 }] }),
}));

import { GET } from "@/app/api/events/route";

describe("GET /api/events — charge utile", () => {
  it("n'envoie qu'un échantillon d'identifiants par foyer, sans toucher aux compteurs", async () => {
    const body = await (await GET(new Request("http://localhost/api/events?range=7d"))).json();
    expect(body.clusters[0]).toMatchObject({ id: "grand", eventCount: 900 });
    expect(body.clusters[0].eventIds).toHaveLength(24);
    // Échantillon réparti (la sélection survit au changement de grille par recouvrement).
    expect(body.clusters[0].eventIds[0]).toBe("evt-0");
    expect(body.clusters[0].eventIds.at(-1)).toBe("evt-899");
    expect(new Set(body.clusters[0].eventIds).size).toBe(24);
    expect(body.clusters[1].eventIds).toEqual(ids(3));
  });
});
