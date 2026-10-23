import { afterEach, describe, expect, it, vi } from "vitest";
import { filtersFromSearchParams } from "@/server/filters";
import { queryLatestEvents } from "@/server/intel";

type TestState = { repository: { query: (query: unknown) => Promise<unknown[]> }; ready: Promise<void> | null };
const globalState = globalThis as unknown as { __orbitalIntelState: TestState; __orbitalSelectionCache?: Map<string, unknown> };
const originalRepository = globalState.__orbitalIntelState.repository;
const originalReady = globalState.__orbitalIntelState.ready;

afterEach(() => {
  globalState.__orbitalIntelState.repository = originalRepository;
  globalState.__orbitalIntelState.ready = originalReady;
  globalState.__orbitalSelectionCache?.clear();
});

describe("sélection partagée pendant un cache expiré", () => {
  it("une rafale identique ne déclenche qu'une lecture base", async () => {
    let finish!: (rows: unknown[]) => void;
    const pending = new Promise<unknown[]>((resolve) => { finish = resolve; });
    const query = vi.fn(() => pending);
    globalState.__orbitalIntelState.repository = { ...originalRepository, query };
    globalState.__orbitalIntelState.ready = Promise.resolve();
    globalState.__orbitalSelectionCache?.clear();
    const filters = filtersFromSearchParams(new URLSearchParams({ range: "30d" }));
    const calls = Array.from({ length: 25 }, () => queryLatestEvents(filters));
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    finish([]);
    const results = await Promise.all(calls);
    expect(results).toHaveLength(25);
    expect(results.every((rows) => rows.length === 0)).toBe(true);
  });
});
