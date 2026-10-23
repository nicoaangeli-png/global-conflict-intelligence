import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/intel", () => ({ healthInfo: () => ({ repository: "sqlite", lastIngestAt: null, connectors: [], report: "" }) }));
vi.mock("@/server/agent", () => ({ agentConfigured: () => false }));

import { GET as health } from "@/app/api/health/route";
import { GET as status } from "@/app/api/sources/status/route";
import { recordAttempt, resetSourceHealth } from "@/server/health/registry";
import "@/server/feeds";

describe("routes de santé — lecture seule", () => {
  beforeEach(() => resetSourceHealth());

  it("/api/sources/status liste les sources avec un statut normalisé, sans appel réseau", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    recordAttempt({ id: "feed:essai", kind: "feed", name: "Essai", category: "health" }, { ok: true, startedAt: Date.now() - 50, finishedAt: Date.now(), itemCount: 4, newestDataAt: new Date().toISOString() });
    const body = await (await status(new Request("http://localhost/api/sources/status"))).json();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(body.summary.healthy).toBe(1);
    expect(body.sources[0]).toMatchObject({ id: "feed:essai", kind: "feed", status: "healthy", itemCount: 4, latencyMs: 50 });
    expect(body.sources[0]).toHaveProperty("dataAgeMs");
    expect(body.sources[0]).toHaveProperty("provenance");
    fetchSpy.mockRestore();
  });

  it("/api/health : « degraded » quand plus de la moitié des sources interrogées échouent", async () => {
    const at = Date.now();
    recordAttempt({ id: "feed:a", kind: "feed", name: "A", category: "health" }, { ok: true, startedAt: at, finishedAt: at, itemCount: 1 });
    expect((await (await health(new Request("http://localhost/api/health"))).json()).status).toBe("ok");
    recordAttempt({ id: "feed:b", kind: "feed", name: "B", category: "health" }, { ok: false, startedAt: at, finishedAt: at, error: "x" });
    recordAttempt({ id: "feed:c", kind: "feed", name: "C", category: "health" }, { ok: false, startedAt: at, finishedAt: at, error: "y" });
    const body = await (await health(new Request("http://localhost/api/health"))).json();
    expect(body).toMatchObject({ status: "degraded", storage: { kind: "sqlite" }, aura: { configured: false, rateLimit: { backend: "memory", distributed: false, status: "healthy" } } });
  });
});
