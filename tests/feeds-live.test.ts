import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildWorldIndex } from "@/lib/geo/world";
import { getFeeds } from "@/server/feeds";

/**
 * Appel RÉEL de toutes les sources (réseau). Désactivé par défaut : `FEEDS_LIVE=1 pnpm vitest run tests/feeds-live.test.ts`.
 * Écrit le résultat dans FEEDS_LIVE_OUT (défaut /tmp/feeds-live.json).
 */
describe.skipIf(!process.env.FEEDS_LIVE)("flux mondiaux — appel réel", () => {
  it("interroge toutes les sources", async () => {
    const geojson = JSON.parse(await readFile(path.join(process.cwd(), "public", "data", "ne_110m_countries.geojson"), "utf8"));
    const index = buildWorldIndex(geojson);
    const response = await getFeeds({ limit: 1000 }, { getIndex: async () => index });
    await writeFile(process.env.FEEDS_LIVE_OUT ?? "/tmp/feeds-live.json", JSON.stringify(response, null, 1));
    for (const s of response.sources) console.log(s.sourceId.padEnd(14), s.status.padEnd(6), String(s.itemCount).padStart(4), s.message ?? "");
    expect(response.sources.length).toBeGreaterThan(0);
  }, 120_000);
});
