import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ storage: vi.fn(), peek: vi.fn(), health: vi.fn() }));
vi.mock("@/server/intel", () => ({ probeStorage: mocks.storage, healthInfo: () => ({ repository: "sqlite", lastIngestAt: null, schema: { schemaVersion: 4, integrity: "ok" } }) }));
vi.mock("@/server/aura/rateLimitStore", () => ({
  rateLimitStore: () => ({ peek: mocks.peek, health: mocks.health }),
  rateLimitHealth: () => mocks.health(),
}));
vi.mock("@/server/agent", () => ({ agentConfigured: () => false }));

import { applicationHealth, checkReadiness, resetReadiness } from "@/server/health/service";
import { GET as ready } from "@/app/api/health/ready/route";

beforeEach(() => {
  resetReadiness();
  vi.restoreAllMocks();
  mocks.storage.mockReset().mockResolvedValue(true);
  mocks.peek.mockReset().mockResolvedValue(0);
  mocks.health.mockReset().mockReturnValue({ backend: "memory", distributed: false, status: "healthy" });
});

describe("readiness sans interrogation des sources externes", () => {
  it("est prête quand stockage et protection répondent, puis récupère après une panne", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
    mocks.storage.mockResolvedValueOnce(false).mockResolvedValue(true);
    expect((await ready(new Request("http://localhost/api/health/ready"))).status).toBe(503);
    expect(applicationHealth().readiness.status).toBe("not_ready");
    clock.mockReturnValue(106_000);
    const response = await ready(new Request("http://localhost/api/health/ready"));
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("ready");
    expect(applicationHealth().readiness.status).toBe("ready");
    clock.mockReturnValue(122_000);
    expect(applicationHealth().readiness.status).toBe("unknown");
  });

  it("échoue fermée si le limiter critique est indisponible et coalesce les probes", async () => {
    mocks.peek.mockRejectedValue(new Error("backend offline"));
    const [one, two] = await Promise.all([checkReadiness(), checkReadiness()]);
    expect(one.status).toBe("not_ready");
    expect(two.status).toBe("not_ready");
    expect(mocks.storage).toHaveBeenCalledTimes(1);
    expect(mocks.peek).toHaveBeenCalledTimes(1);
    expect(applicationHealth().aura.rateLimit.status).toBe("healthy");
  });
});
