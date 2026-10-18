import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEED_SOURCES, getFeeds, parseCategory, sortItems } from "@/server/feeds";
import { clearFeedsCache, FeedError, fetchJson, runSource, type FeedSourceDef } from "@/server/feeds/util";
import { FEED_CATEGORIES, type LiveItem } from "@/types/feeds";

const item = (over: Partial<LiveItem>): LiveItem => ({
  id: "x:1",
  category: "disaster",
  nature: "official_alert",
  title: "t",
  summary: null,
  url: null,
  sourceId: "x",
  sourceName: "X",
  publishedAt: null,
  occurredAt: null,
  fetchedAt: "2026-10-18T10:00:00.000Z",
  countries: [],
  lat: null,
  lon: null,
  severity: null,
  metric: null,
  caveat: null,
  ...over,
});

function def(over: Partial<FeedSourceDef> & { load: FeedSourceDef["load"] }): FeedSourceDef {
  return { sourceId: "test", sourceName: "Test", category: "disaster", homepage: "https://example.org", license: null, ttlMs: 60_000, ...over };
}

beforeEach(() => clearFeedsCache());
afterEach(() => vi.unstubAllGlobals());

describe("registre des sources", () => {
  it("couvre toutes les catégories du contrat, « social » compris", () => {
    const categories = new Set(FEED_SOURCES.map((s) => s.category));
    expect([...categories].sort()).toEqual([...FEED_CATEGORIES].sort());
    const ids = FEED_SOURCES.map((s) => s.sourceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("parseCategory n'accepte que les catégories connues", () => {
    expect(parseCategory("Space")).toBe("space");
    expect(parseCategory("nope")).toBeNull();
    expect(parseCategory(null)).toBeNull();
  });
});

describe("runSource", () => {
  it("met en cache pendant le TTL et dédoublonne les appels simultanés", async () => {
    let calls = 0;
    const source = def({ load: async (c) => (calls++, [item({ fetchedAt: c.fetchedAt })]) });
    const [a, b] = await Promise.all([runSource(source, async () => null), runSource(source, async () => null)]);
    await runSource(source, async () => null);
    expect(calls).toBe(1);
    expect(a.state.status).toBe("ok");
    expect(a.state.itemCount).toBe(1);
    expect(b.items).toHaveLength(1);
  });

  it("recharge après expiration du TTL", async () => {
    let calls = 0;
    let clock = 1_000_000;
    const source = def({ ttlMs: 1000, load: async () => (calls++, []) });
    await runSource(source, async () => null, () => clock);
    clock += 500;
    await runSource(source, async () => null, () => clock);
    clock += 1000;
    await runSource(source, async () => null, () => clock);
    expect(calls).toBe(2);
  });

  it("une erreur devient un état « error » lisible, jamais une exception", async () => {
    const source = def({ load: async () => { throw new FeedError("example.org est injoignable."); } });
    const { items, state } = await runSource(source, async () => null);
    expect(items).toEqual([]);
    expect(state.status).toBe("error");
    expect(state.message).toBe("example.org est injoignable.");
  });

  it("une erreur inattendue ne fuit aucun détail technique", async () => {
    const source = def({ load: async () => { throw new TypeError("Cannot read properties of undefined (reading 'x')"); } });
    const { state } = await runSource(source, async () => null);
    expect(state.status).toBe("error");
    expect(state.message).not.toMatch(/undefined|TypeError/);
  });

  it("après un échec, conserve les dernières données valides en « stale »", async () => {
    let clock = 0;
    let fail = false;
    const source = def({ ttlMs: 10, errorTtlMs: 10, load: async () => { if (fail) throw new FeedError("quota dépassé"); return [item({})]; } });
    await runSource(source, async () => null, () => clock);
    clock += 100;
    fail = true;
    const { items, state } = await runSource(source, async () => null, () => clock);
    expect(items).toHaveLength(1);
    expect(state.status).toBe("stale");
    expect(state.message).toContain("quota dépassé");
  });

  it("ne retente pas avant la fin du délai d'erreur (quota)", async () => {
    let calls = 0;
    let clock = 0;
    const source = def({ ttlMs: 3_600_000, errorTtlMs: 600_000, load: async () => { calls++; throw new FeedError("429"); } });
    await runSource(source, async () => null, () => clock);
    clock += 60_000;
    await runSource(source, async () => null, () => clock);
    expect(calls).toBe(1);
    clock += 600_000;
    await runSource(source, async () => null, () => clock);
    expect(calls).toBe(2);
  });
});

describe("getFeeds", () => {
  const a = def({ sourceId: "a", category: "disaster", load: async () => [item({ id: "a:1", occurredAt: "2026-10-18T08:00:00.000Z", countries: ["IDN"] }), item({ id: "a:2", publishedAt: "2026-10-18T09:00:00.000Z", countries: ["FRA", "ITA"] })] });
  const b = def({ sourceId: "b", category: "health", load: async () => [item({ id: "b:1", category: "health", occurredAt: "2026-10-17T00:00:00.000Z", countries: ["FRA"] })] });
  const broken = def({ sourceId: "c", category: "space", load: async () => { throw new FeedError("hors service"); } });
  const opts = { sources: [a, b, broken], getIndex: async () => null };

  it("trie par date propre décroissante et ne casse pas si une source échoue", async () => {
    const res = await getFeeds({}, opts);
    expect(res.items.map((i) => i.id)).toEqual(["a:2", "a:1", "b:1"]);
    expect(res.sources.map((s) => [s.sourceId, s.status])).toEqual([["a", "ok"], ["b", "ok"], ["c", "error"]]);
    expect(res.generatedAt).toMatch(/Z$/);
  });

  it("filtre par catégorie, par pays ISO3 et limite", async () => {
    expect((await getFeeds({ category: "health" }, opts)).items.map((i) => i.id)).toEqual(["b:1"]);
    expect((await getFeeds({ country: "fra" }, opts)).items.map((i) => i.id)).toEqual(["a:2", "b:1"]);
    expect((await getFeeds({ limit: 1 }, opts)).items).toHaveLength(1);
    expect((await getFeeds({ category: "inconnue" }, opts)).items).toEqual([]);
    expect((await getFeeds({ category: "social" }, opts)).sources).toEqual([]);
  });

  it("sortItems est stable à date égale", () => {
    const sorted = sortItems([item({ id: "z" }), item({ id: "a" })]);
    expect(sorted.map((i) => i.id)).toEqual(["a", "z"]);
  });
});

describe("réseau (fetch simulé)", () => {
  it("HTTP 403 : message honnête, sans contournement", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 403 })));
    await expect(fetchJson("https://www.aaro.mil/")).rejects.toThrow(/refuse l'accès automatisé.*aucun contournement/);
  });

  it("HTTP 429 : message de quota", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));
    await expect(fetchJson("https://ll.thespacedevs.com/x")).rejects.toThrow(/limite le nombre de requêtes/);
  });

  it("JSON invalide : message lisible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    await expect(fetchJson("https://example.org/x")).rejects.toThrow(/illisible/);
  });

  it("envoie le User-Agent ORBITAL et un signal de délai", async () => {
    const spy = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await fetchJson("https://example.org/x");
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("ORBITAL/0.2 (planetary monitor; contact nicoa.angeli@gmail.com)");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("source AARO : état « error » honnête quand le site refuse (HTTP 403)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 403 })));
    const aaro = FEED_SOURCES.find((s) => s.sourceId === "aaro")!;
    const { items, state } = await runSource(aaro, async () => null);
    expect(items).toEqual([]);
    expect(state.status).toBe("error");
    expect(state.message).toMatch(/403/);
  });
});
