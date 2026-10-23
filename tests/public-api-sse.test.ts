import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRateLimitStore } from "@/server/aura/rateLimit";
import { setRateLimitStore } from "@/server/aura/rateLimitStore";
import { sseMetrics } from "@/server/publicApi/limits";
import { renderMetrics, resetMetrics } from "@/server/observability/metrics";

const subscribers = new Set<(chunk: string) => void>();
vi.mock("@/server/intel", () => ({
  ensureReady: vi.fn(async () => undefined),
  subscribe: vi.fn((fn: (chunk: string) => void) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; }),
}));
import { GET } from "@/app/api/stream/route";

function connect(ip: string, controller = new AbortController()) {
  return { controller, response: GET(new Request("http://localhost/api/stream", { headers: { "x-forwarded-for": ip }, signal: controller.signal })) };
}

beforeEach(() => {
  resetMetrics();
  vi.stubEnv("ORBITAL_TRUST_PROXY", "1");
  vi.stubEnv("ORBITAL_SSE_MAX_CONNECTIONS", "2");
  vi.stubEnv("ORBITAL_SSE_MAX_PER_CLIENT", "1");
  vi.stubEnv("ORBITAL_SSE_CLIENT_RECONNECTS_PER_MINUTE", "4");
  setRateLimitStore(new MemoryRateLimitStore());
  sseMetrics().__orbitalSseActive = 0;
});
afterEach(() => { vi.unstubAllEnvs(); subscribers.clear(); });

describe("SSE", () => {
  it("limite les connexions par client et globalement, puis libère à l'annulation", async () => {
    const first = await connect("198.51.100.1").response;
    const second = await connect("198.51.100.2").response;
    expect([first.status, second.status]).toEqual([200, 200]);
    expect((await connect("198.51.100.1").response).status).toBe(429);
    expect((await connect("198.51.100.3").response).status).toBe(429);
    expect(subscribers.size).toBe(2);
    await first.body!.cancel();
    expect(subscribers.size).toBe(1);
    const replacement = await connect("198.51.100.3").response;
    expect(replacement.status).toBe(200);
    await Promise.all([second.body!.cancel(), replacement.body!.cancel()]);
    expect(subscribers.size).toBe(0);
    expect(sseMetrics().__orbitalSseActive).toBe(0);
    expect(renderMetrics()).toContain('orbital_sse_events_total{event="accepted"} 3');
    expect(renderMetrics()).toContain('orbital_sse_events_total{event="refused"} 2');
  });

  it("AbortSignal ferme le flux et permet la reconnexion", async () => {
    const connection = connect("198.51.100.4");
    const response = await connection.response;
    connection.controller.abort();
    await vi.waitFor(() => expect(subscribers.size).toBe(0));
    const replacement = await connect("198.51.100.4").response;
    expect(replacement.status).toBe(200);
    await replacement.body!.cancel();
    await response.body?.cancel().catch(() => undefined);
  });

  it("ferme le consommateur lent avant que sa file ne croisse sans borne", async () => {
    const response = await connect("198.51.100.5").response;
    expect(response.status).toBe(200);
    for (let i = 0; i < 10; i++) for (const send of [...subscribers]) send(`event: ingest\ndata: ${i}\n\n`);
    await vi.waitFor(() => expect(subscribers.size).toBe(0));
    expect(sseMetrics().__orbitalSseActive).toBe(0);
    expect(renderMetrics()).toContain('orbital_sse_events_total{event="backpressure"} 1');
    await response.body!.cancel();
  });

  it("refuse les reconnexions rapides même si chaque flux est fermé", async () => {
    for (let i = 0; i < 4; i++) {
      const response = await connect("198.51.100.6").response;
      expect(response.status).toBe(200);
      await response.body!.cancel();
    }
    expect((await connect("198.51.100.6").response).status).toBe(429);
  });

  it("échoue fermé sans divulguer l'erreur interne du store", async () => {
    const broken = new MemoryRateLimitStore();
    vi.spyOn(broken, "acquire").mockRejectedValue(new Error("private database url"));
    setRateLimitStore(broken);
    const response = await connect("198.51.100.7").response;
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database url");
    expect(sseMetrics().__orbitalSseActive).toBe(0);
  });
});
