import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/intel", () => ({
  healthInfo: () => ({ repository: "sqlite", report: "rapport interne" }),
  runIngest: vi.fn(async () => ({ ok: true })),
}));

import { GET } from "@/app/api/ingest/route";

const authorized = () =>
  new Request("http://localhost/api/ingest", { headers: { authorization: "Bearer secret" } });

beforeEach(() => vi.stubEnv("INGEST_TOKEN", "secret"));
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/ingest — état d'exploitation", () => {
  it("exige le jeton d'ingestion (le rapport détaillé n'est plus public)", async () => {
    expect((await GET(new Request("http://localhost/api/ingest"))).status).toBe(401);
    expect((await GET(new Request("http://localhost/api/ingest", { headers: { authorization: "Bearer faux" } }))).status).toBe(401);
    const response = await GET(authorized());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ repository: "sqlite" });
  });

  it("répond 503 quand l'ingestion n'est pas configurée", async () => {
    vi.stubEnv("INGEST_TOKEN", "");
    expect((await GET(authorized())).status).toBe(503);
  });
});
