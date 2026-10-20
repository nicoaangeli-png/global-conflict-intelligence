import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFeeds } from "@/server/feeds";
import { clearFeedsCache, FeedError, runSource, type FeedSourceDef } from "@/server/feeds/util";
import { getSourceHealth, recordAttempt, resetSourceHealth, sourcesStatus } from "@/server/health/registry";
import type { LiveItem } from "@/types/feeds";

const noIndex = async () => null;

function item(id: string, publishedAt: string): LiveItem {
  return {
    id,
    sourceId: "test",
    sourceName: "Source test",
    category: "health",
    nature: "official_publication",
    title: `Élément ${id}`,
    summary: null,
    url: "https://example.org/",
    publishedAt,
    occurredAt: null,
    fetchedAt: "2026-10-20T10:00:00.000Z",
    countries: [],
    lat: null,
    lon: null,
    severity: null,
    caveat: null,
    metric: null,
  } as unknown as LiveItem;
}

function source(id: string, load: FeedSourceDef["load"], extra: Partial<FeedSourceDef> = {}): FeedSourceDef {
  return { sourceId: id, sourceName: `Source ${id}`, category: "health", homepage: "https://example.org/", license: null, ttlMs: 60_000, load, ...extra };
}

beforeEach(() => {
  resetSourceHealth();
  clearFeedsCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("santé des sources — flux", () => {
  it("source saine : latence, nombre d'éléments, date de la donnée la plus récente", async () => {
    let clock = Date.parse("2026-10-20T10:00:00.000Z");
    const def = source("ok", async () => {
      clock += 120;
      return [item("a", "2026-10-19T08:00:00.000Z"), item("b", "2026-10-20T06:30:00.000Z")];
    });
    const { state } = await runSource(def, noIndex, () => clock);
    expect(state).toMatchObject({ status: "ok", health: "healthy", newestDataAt: "2026-10-20T06:30:00.000Z", latencyMs: 120 });
    expect(getSourceHealth("feed:ok", clock)).toMatchObject({ kind: "feed", status: "healthy", itemCount: 2, lastError: null });
  });

  it("succès partiel signalé par la source : dégradée", async () => {
    const { state } = await runSource(source("partiel", async () => ({ items: [item("a", "2026-10-20T06:00:00.000Z")], message: "Une page sur deux est indisponible." })), noIndex);
    expect(state.health).toBe("degraded");
    expect(getSourceHealth("feed:partiel")?.lastError).toContain("Une page sur deux");
  });

  it("échec après un succès : anciennes données servies, état « stale » ; sans succès antérieur : « unavailable »", async () => {
    let clock = Date.parse("2026-10-20T10:00:00.000Z");
    let fail = false;
    const def = source("instable", async () => {
      if (fail) throw new FeedError("example.org a répondu HTTP 503.");
      return [item("a", "2026-10-20T06:00:00.000Z")];
    });
    await runSource(def, noIndex, () => clock);
    fail = true;
    clock += 10 * 60_000;
    const { items, state } = await runSource(def, noIndex, () => clock);
    expect(items).toHaveLength(1);
    expect(state).toMatchObject({ status: "stale", health: "stale" });
    expect(getSourceHealth("feed:instable")).toMatchObject({ status: "stale", itemCount: 1, lastError: "example.org a répondu HTTP 503." });

    const never = await runSource(source("morte", async () => { throw new FeedError("injoignable"); }), noIndex);
    expect(never.state.health).toBe("unavailable");
  });

  it("dernier succès trop ancien (au-delà de 3 périodes) : « stale » même sans nouvel échec", () => {
    const descriptor = { id: "feed:vieille", kind: "feed" as const, name: "Vieille", category: "health", staleAfterMs: 60_000 };
    recordAttempt(descriptor, { ok: true, startedAt: 0, finishedAt: 1_000, itemCount: 3 });
    expect(getSourceHealth("feed:vieille", 30_000)?.status).toBe("healthy");
    expect(getSourceHealth("feed:vieille", 120_000)?.status).toBe("stale");
  });

  it("source non branchée : « unconfigured », sans appel réseau", async () => {
    const load = vi.fn();
    const { state } = await runSource(source("sans-cle", load, { unavailable: { status: "not_configured", message: "Clé absente." } }), noIndex);
    expect(load).not.toHaveBeenCalled();
    expect(state.health).toBe("unconfigured");
  });

  it("une source en panne ne fait pas tomber /api/feeds : les autres répondent", async () => {
    const response = await getFeeds({}, {
      sources: [
        source("saine", async () => [item("ok-1", "2026-10-20T05:00:00.000Z")]),
        source("panne", async () => { throw new TypeError("JSON inattendu"); }),
      ],
      getIndex: noIndex,
    });
    expect(response.items.map((entry) => entry.id)).toEqual(["ok-1"]);
    expect(response.sources.map((state) => [state.sourceId, state.health])).toEqual([["saine", "healthy"], ["panne", "unavailable"]]);
    // Erreur inattendue : message générique, jamais le détail technique.
    expect(response.sources[1].message).not.toContain("TypeError");
  });

  it("masque les secrets dans la dernière erreur connue", () => {
    vi.stubEnv("FIRMS_MAP_KEY", "cle-firms-secrete-1234");
    recordAttempt({ id: "connector:firms", kind: "connector", name: "FIRMS", category: "conflicts" }, { ok: false, startedAt: 0, finishedAt: 5, error: "échec https://firms.example/api/cle-firms-secrete-1234/csv" });
    expect(getSourceHealth("connector:firms")?.lastError).not.toContain("cle-firms-secrete-1234");
  });

  it("résumé par statut", () => {
    recordAttempt({ id: "feed:a", kind: "feed", name: "A", category: "health" }, { ok: true, startedAt: 0, finishedAt: 1, itemCount: 1 });
    recordAttempt({ id: "feed:b", kind: "feed", name: "B", category: "health" }, { ok: false, startedAt: 0, finishedAt: 1, error: "x" });
    expect(sourcesStatus(2).summary).toMatchObject({ healthy: 1, unavailable: 1, stale: 0 });
  });
});
