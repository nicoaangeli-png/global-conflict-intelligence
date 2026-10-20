import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { regenerateBriefing } = vi.hoisted(() => ({
  regenerateBriefing: vi.fn(async () => ({ ok: true as const, briefing: { date: "2026-10-20" } })),
}));
vi.mock("@/server/briefing", () => ({
  getBriefing: vi.fn(async () => ({ date: "2026-10-20" })),
  regenerateBriefing,
}));

import { POST } from "@/app/api/briefing/route";

const request = (headers: Record<string, string>, body = JSON.stringify({ force: true })) =>
  new Request("http://localhost/api/briefing", { method: "POST", headers, body });

const safeHeaders = {
  host: "localhost",
  origin: "http://localhost:3000",
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
  "x-orbital-client": "aura",
};

beforeEach(() => vi.stubEnv("AURA_ALLOWED_ORIGINS", ""));
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/briefing — contrôle d'origine", () => {
  it("refuse l'ancien joker *.sslip.io et exige le client AURA", async () => {
    expect((await POST(request({ ...safeHeaders, host: "evil.sslip.io", origin: "http://evil.sslip.io" }))).status).toBe(403);
    expect((await POST(request({ ...safeHeaders, "x-orbital-client": "autre" }))).status).toBe(403);
    expect((await POST(request({ ...safeHeaders, origin: "https://exemple.test" }))).status).toBe(403);
  });

  it("accepte la boucle locale et borne le corps", async () => {
    const ok = await POST(request(safeHeaders));
    expect(ok.status).toBe(200);
    expect(regenerateBriefing).toHaveBeenCalledTimes(1);

    const big = await POST(request(safeHeaders, "x".repeat(2048)));
    expect(big.status).toBe(413);
  });
});
