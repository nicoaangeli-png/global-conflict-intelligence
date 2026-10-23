import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRateLimitStore } from "@/server/aura/rateLimit";
import { setRateLimitStore } from "@/server/aura/rateLimitStore";
import { guardPublicApi, publicApiHealth } from "@/server/publicApi/limits";
import { validatePublicFilters, validatePublicQuery } from "@/server/publicApi/parameters";

const request = (ip = "198.51.100.1") => new Request("http://localhost/api/events", { headers: { "x-forwarded-for": ip } });

beforeEach(() => {
  vi.stubEnv("ORBITAL_TRUST_PROXY", "1");
  vi.stubEnv("ORBITAL_PUBLIC_API_CLIENT_UNITS_PER_MINUTE", "4");
  vi.stubEnv("ORBITAL_PUBLIC_API_GLOBAL_UNITS_PER_MINUTE", "8");
  setRateLimitStore(new MemoryRateLimitStore());
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("API publiques", () => {
  it("borne le burst client et le burst global par route", async () => {
    expect(await guardPublicApi(request(), "events")).toBeNull();
    expect(await guardPublicApi(request(), "events")).toBeNull();
    expect((await guardPublicApi(request(), "events"))?.status).toBe(429);
    expect(await guardPublicApi(request("198.51.100.2"), "events")).toBeNull();
    expect(await guardPublicApi(request("198.51.100.2"), "events")).toBeNull();
    expect((await guardPublicApi(request("198.51.100.3"), "events"))?.status).toBe(429);
    expect(await guardPublicApi(request(), "latest")).toBeNull();
    expect(publicApiHealth().rejected429).toBeGreaterThanOrEqual(2);
  });

  it("ne croit pas l'en-tête client sans proxy déclaré et protège par la borne globale", async () => {
    vi.stubEnv("ORBITAL_TRUST_PROXY", "");
    for (let i = 0; i < 4; i++) expect(await guardPublicApi(request(String(i)), "events")).toBeNull();
    expect((await guardPublicApi(request("5"), "events"))?.status).toBe(429);
  });

  it("maintient le cooldown de régénération du bilan entre clients et instances", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(await guardPublicApi(request(), "briefing-write")).toBeNull();
    expect((await guardPublicApi(request(), "briefing-write"))?.status).toBe(429);
    expect((await guardPublicApi(request("198.51.100.2"), "briefing-write"))?.status).toBe(429);
    vi.mocked(Date.now).mockReturnValue(now + 600_001);
    expect(await guardPublicApi(request("198.51.100.2"), "briefing-write")).toBeNull();
  });

  it("ne permet pas de contourner le quota total en changeant de route", async () => {
    vi.stubEnv("ORBITAL_PUBLIC_API_TOTAL_GLOBAL_UNITS_PER_MINUTE", "3");
    vi.stubEnv("ORBITAL_PUBLIC_API_TOTAL_CLIENT_UNITS_PER_MINUTE", "3");
    expect(await guardPublicApi(request(), "events")).toBeNull();
    expect(await guardPublicApi(request(), "latest")).toBeNull();
    expect((await guardPublicApi(request(), "stats"))?.status).toBe(429);
  });

  it("refuse de façon contrôlée si le store distribué est indisponible", async () => {
    const broken = new MemoryRateLimitStore();
    vi.spyOn(broken, "consumeMany").mockRejectedValue(new Error("internal SQL password"));
    setRateLimitStore(broken);
    const response = await guardPublicApi(request(), "events");
    expect(response?.status).toBe(503);
    expect(await response?.text()).not.toContain("password");
  });

  it("rejette les entrées extrêmes avant toute lecture coûteuse", () => {
    expect(validatePublicQuery(new URLSearchParams({ q: "x".repeat(513) }))?.status).toBe(400);
    expect(validatePublicFilters(new URLSearchParams({ countries: Array(51).fill("FRA").join(",") }))?.status).toBe(400);
    expect(validatePublicFilters(new URLSearchParams({ minFatalities: "1e100" }))?.status).toBe(400);
    expect(validatePublicFilters(new URLSearchParams({ degrees: "Infinity" }))?.status).toBe(400);
  });
});
