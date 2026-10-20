import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Base SQLite neuve et vide, connecteurs désactivés : les services de la base de
 * conflits répondent sans erreur ni valeur inventée, et sans aucun appel réseau.
 */

const dir = mkdtempSync(path.join(tmpdir(), "orbital-empty-"));

beforeAll(() => {
  vi.stubEnv("ORBITAL_SQLITE_PATH", path.join(dir, "vide.sqlite"));
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("ORBITAL_STORAGE", "");
  for (const name of ["GDELT_DISABLED", "UCDP_DISABLED", "ACLED_DISABLED", "FIRMS_DISABLED"]) vi.stubEnv(name, "1");
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("base de conflits vide", () => {
  it("statistiques et foyers à zéro, dates nulles, aucun appel réseau", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("réseau interdit dans ce test"));
    const { queryClusters, queryLatestEvents, queryStats } = await import("@/server/intel");
    const { filtersFromSearchParams } = await import("@/server/filters");
    const filters = filtersFromSearchParams(new URLSearchParams({ range: "30d" }));

    const stats = await queryStats(filters);
    expect(stats.totalInStore).toBe(0);
    expect(stats.activeZones).toBe(0);
    expect(stats.fatalitiesRange).toBe(0);
    expect((stats.sources ?? []).every((source) => source.latestEventAt === null && source.recordsInStore === 0)).toBe(true);

    expect((await queryClusters(filters, 2.4)).clusters).toEqual([]);
    expect(await queryLatestEvents(filters, 10)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
