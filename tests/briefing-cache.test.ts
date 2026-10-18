import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBriefing, regenerateBriefing, resetBriefingState } from "@/server/briefing";
import type { FeedsResponse } from "@/types/feeds";

const feeds = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "briefing", "feeds.json"), "utf8")) as FeedsResponse;
let clock = Date.parse("2026-10-18T10:00:00.000Z");
const sentence = (text: string, id: string) => ({ text, factIds: [id] });
const aiOk = () =>
  vi.fn(async () =>
    new Response(
      JSON.stringify({
        status: "completed",
        output_text: JSON.stringify({
          chapters: [
            { key: "politics", sentences: [sentence("Vendredi 16 octobre, le Conseil de sécurité adopte une résolution.", "pol-1")] },
            { key: "disasters", sentences: [sentence("Séisme au Japon.", "cat-1")] },
            { key: "society", sentences: [sentence("Selon plusieurs médias, des affrontements ont éclaté à Limoges.", "soc-1")] },
            { key: "nuclear", sentences: [sentence("Vendredi 16 octobre, l'ONU évoque la centrale de Zaporijia.", "nuc-1")] },
            { key: "economy", sentences: [sentence("À la clôture de vendredi, le CAC 40 recule, selon Yahoo Finance, source non officielle.", "eco-1")] },
            { key: "health", sentences: [sentence("Lundi 12 octobre, l'OMS signale une flambée de choléra.", "san-1")] },
          ],
        }),
      }),
      { status: 200 },
    ),
  );
const mk = (fetchMock: ReturnType<typeof aiOk>, dir: string) => ({
  getFeeds: vi.fn(async () => feeds),
  getConflictEvents: vi.fn(async () => []),
  write: { apiKey: "k", fetch: fetchMock as unknown as typeof fetch },
  dir,
  now: () => clock,
});

beforeEach(() => {
  resetBriefingState();
  clock = Date.parse("2026-10-18T10:00:00.000Z");
});

describe("cache journalier et verrou", () => {
  it("un seul bilan par jour UTC, écrit sur disque, régénéré le lendemain", async () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "brief-")), "briefing");
    const f = aiOk();
    const d = mk(f, dir);
    const a = await getBriefing(d);
    const b = await getBriefing(d);
    expect(b).toBe(a);
    expect(f).toHaveBeenCalledTimes(1);
    expect(a.status).toBe("ok");
    expect(existsSync(path.join(dir, "2026-10-18.json"))).toBe(true);
    // relecture depuis le fichier après perte de la mémoire
    resetBriefingState();
    const c = await getBriefing(d);
    expect(c.generatedAt).toBe(a.generatedAt);
    expect(f).toHaveBeenCalledTimes(1);
    clock = Date.parse("2026-10-19T00:00:01.000Z");
    expect((await getBriefing(d)).date).toBe("2026-10-19");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("verrou : des GET concurrents ne déclenchent qu'une génération", async () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "brief-")), "b");
    const f = aiOk();
    const d = mk(f, dir);
    const results = await Promise.all([getBriefing(d), getBriefing(d), getBriefing(d)]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => r.generatedAt)).size).toBe(1);
  });

  it("un bilan dégradé n'est pas écrit sur disque et est réessayé après expiration", async () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "brief-")), "b");
    const d = { ...mk(aiOk(), dir), write: { apiKey: undefined } };
    const a = await getBriefing(d);
    expect(a.status).toBe("degraded");
    expect(existsSync(path.join(dir, "2026-10-18.json"))).toBe(false);
    expect(await getBriefing(d)).toBe(a);
    clock += 16 * 60_000;
    expect(await getBriefing(d)).not.toBe(a);
  });

  it("régénération manuelle limitée à 1 / 10 min", async () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "brief-")), "b");
    const f = aiOk();
    const d = mk(f, dir);
    expect((await regenerateBriefing(d)).ok).toBe(true);
    clock += 60_000;
    const second = await regenerateBriefing(d);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.retryAfterSec).toBe(540);
    clock += 10 * 60_000;
    expect((await regenerateBriefing(d)).ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
