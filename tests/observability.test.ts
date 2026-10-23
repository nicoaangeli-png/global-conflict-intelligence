import { beforeEach, describe, expect, it, vi } from "vitest";
import { increment, inFlight, observe, registerMetricSource, renderMetrics, resetMetrics } from "@/server/observability/metrics";
import { instrumentRoute } from "@/server/observability/http";
import { log } from "@/server/observability/logger";
import { recordAttempt, resetSourceHealth } from "@/server/health/registry";
import { exportMetrics } from "@/server/observability/export";
import { GET as metricsRoute } from "@/app/api/metrics/route";
import { GET as livenessRoute } from "@/app/api/health/live/route";

beforeEach(() => { resetMetrics(); resetSourceHealth(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("observabilité locale, bornée et sans données utilisateur", () => {
  it("compte méthode, statut 429/503, requêtes en cours et durée sans étiquette URL", async () => {
    const slow = instrumentRoute("/api/events", async () => {
      expect(renderMetrics()).toContain('orbital_http_in_flight{route="/api/events",method="GET"} 1');
      return new Response("limit", { status: 429 });
    });
    const response = await slow(new Request("http://localhost/api/events?token=private&client=192.0.2.1", { headers: { "X-Request-Id": "user-injected" } }));
    expect(response.status).toBe(429);
    expect(response.headers.get("X-Request-Id")).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers.get("X-Request-Id")).not.toBe("user-injected");
    const unavailable = instrumentRoute("/api/events", async () => new Response(null, { status: 503 }));
    await unavailable(new Request("http://localhost/api/events"));
    const output = renderMetrics();
    expect(output).toContain('orbital_http_requests_total{route="/api/events",method="GET",status="429"} 1');
    expect(output).toContain('orbital_http_requests_total{route="/api/events",method="GET",status="503"} 1');
    expect(output).toContain('orbital_http_in_flight{route="/api/events",method="GET"} 0');
    expect(output).toContain('orbital_http_duration_seconds_count{route="/api/events",method="GET"} 2');
    expect(output).not.toMatch(/private|192\.0\.2\.1|user-injected/);
  });

  it("préserve la réponse métier si le sink de logs échoue, et ne consomme pas le flux", async () => {
    vi.spyOn(console, "log").mockImplementation(() => { throw new Error("sink broken"); });
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("ok")); controller.close(); } });
    const route = instrumentRoute("/api/agent", async () => new Response(body));
    const response = await route(new Request("http://localhost/api/agent"));
    expect(response.body).toBe(body);
    expect(await response.text()).toBe("ok");
  });

  it("borne les labels et les séries, y compris une source arbitraire", () => {
    increment("public_api_rejections_total", { route: "/api/events?token=secret", reason: "192.0.2.1" });
    registerMetricSource("feed:known");
    increment("source_attempts_total", { source: "feed:known", result: "success" });
    increment("source_attempts_total", { source: "feed:prompt-secret", result: "success" });
    inFlight("/private/123", "EVIL", 1);
    observe("http_duration_seconds", { route: "/private/123", method: "EVIL" }, 0.02);
    const output = renderMetrics();
    expect(output).toContain('orbital_public_api_rejections_total{route="other",reason="other"} 1');
    expect(output).toContain('orbital_source_attempts_total{source="feed:known",result="success"} 1');
    expect(output).not.toMatch(/secret|192\.0\.2\.1|private\/123|EVIL/);
  });

  it("journalise une seule ligne JSON contrôlée, sans prompt, IP, header ni secret", () => {
    vi.stubEnv("ORBITAL_LOG_LEVEL", "debug");
    vi.stubEnv("OPENAI_API_KEY", "sk-supersecretvalue");
    const sink = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    log("warn", "agent_failed", { subsystem: "aura", errorCode: "sk-supersecretvalue", prompt: "PROMPT SECRET", ip: "192.0.2.2", authorization: "Bearer sk-supersecretvalue" } as never);
    const entry = JSON.parse(String(sink.mock.calls[0][0]));
    expect(entry).toMatchObject({ level: "warn", event: "agent_failed", subsystem: "aura", errorCode: "other" });
    expect(JSON.stringify(entry)).not.toMatch(/PROMPT SECRET|192\.0\.2\.2|supersecretvalue|authorization|prompt/);
  });

  it("exporte des jauges processus et sources sans collecte externe", () => {
    const at = Date.now();
    recordAttempt({ id: "feed:check", kind: "feed", name: "Check", category: "health" }, { ok: true, startedAt: at - 100, finishedAt: at, itemCount: 7, newestDataAt: new Date(at - 1000).toISOString() });
    const output = exportMetrics(at);
    expect(output).toContain('orbital_source_attempts_total{source="feed:check",result="success"} 1');
    expect(output).toContain('orbital_source_items{source="feed:check"} 7');
    expect(output).toContain("# TYPE orbital_process_resident_memory_bytes gauge");
    expect(output).toContain("# TYPE orbital_source_duration_seconds histogram");
    expect(output).not.toMatch(/NaN|Infinity|# TYPE .* undefined/);
  });

  it("protège /api/metrics par jeton et garde /api/health/live rapide", async () => {
    vi.stubEnv("ORBITAL_METRICS_TOKEN", "token-example-secret");
    const unauthorized = await metricsRoute(new Request("http://localhost/api/metrics"));
    expect(unauthorized.status).toBe(401);
    const authorized = await metricsRoute(new Request("http://localhost/api/metrics", { headers: { Authorization: "Bearer token-example-secret" } }));
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("Content-Type")).toContain("version=0.0.4");
    expect(await authorized.text()).not.toContain("token-example-secret");
    const live = await livenessRoute(new Request("http://localhost/api/health/live"));
    expect(live.status).toBe(200);
    expect((await live.json()).status).toBe("alive");
    vi.stubEnv("ORBITAL_METRICS_TOKEN", "");
    vi.stubEnv("NODE_ENV", "production");
    expect((await metricsRoute(new Request("http://localhost/api/metrics"))).status).toBe(503);
  });
});
