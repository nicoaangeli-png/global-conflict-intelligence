import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/intel", () => ({
  queryClusterEvents: vi.fn(async () => ({ cluster: { id: "z-1" }, events: [] })),
}));

import { POST } from "@/app/api/cluster/route";
import { queryClusterEvents } from "@/server/intel";

const jsonRequest = (body: unknown) =>
  new Request("http://localhost/api/cluster", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const validBody = { filters: { range: "7d", degrees: "2.40" }, degrees: 2.4, lat: 15.5, lon: 32.5, clusterId: "z-1" };

describe("POST /api/cluster", () => {
  it("exige un corps JSON borné et validé", async () => {
    const noType = new Request("http://localhost/api/cluster", { method: "POST", body: JSON.stringify(validBody) });
    expect((await POST(noType)).status).toBe(415);

    const tooBig = new Request("http://localhost/api/cluster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, padding: "x".repeat(20_000) }),
    });
    expect((await POST(tooBig)).status).toBe(413);

    expect((await POST(jsonRequest({ ...validBody, lat: "nord" }))).status).toBe(400);
    expect((await POST(jsonRequest({ ...validBody, degrees: 500 }))).status).toBe(200);
    expect((await POST(jsonRequest(validBody))).status).toBe(200);
    // Le rayon hors bornes est ramené dans l'intervalle autorisé, jamais transmis tel quel.
    expect(vi.mocked(queryClusterEvents).mock.calls.at(-2)?.[1]).toBe(30);
    expect(vi.mocked(queryClusterEvents).mock.calls.at(-1)?.[2]).toBe(15.5);
  });
});
