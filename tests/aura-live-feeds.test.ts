import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEED_CATEGORIES, type FeedsResponse } from "@/types/feeds";

const mocks = vi.hoisted(() => ({ getFeeds: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/feeds", () => ({ getFeeds: mocks.getFeeds }));

import { AGENT_TOOLS, LIVE_FEEDS_MAX_LIMIT, runAgent } from "@/server/agent";

const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "aura", "live-feeds.json"), "utf8")) as FeedsResponse;
const encoder = new TextEncoder();

function sse(events: unknown[]) {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function functionCall(name: string, args: Record<string, unknown>) {
  return {
    type: "response.output_item.done",
    output_index: 0,
    item: { type: "function_call", call_id: "call_live", name, arguments: JSON.stringify(args) },
  };
}

async function collectLiveFeed(args: Record<string, unknown>) {
  const rounds = [
    [functionCall("get_live_feeds", args), { type: "response.completed", response: { id: "response_live" } }],
    [{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Réponse sourcée." }, { type: "response.completed", response: { id: "response_final" } }],
  ];
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(sse(rounds.shift()!), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
  vi.stubGlobal("fetch", fetchMock);
  const chunks = [];
  for await (const chunk of runAgent([{ role: "user", content: "Actualité de la France" }], { locale: "fr" })) chunks.push(chunk);
  const outputRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as { input: Array<{ output: string }> };
  return { chunks, fetchMock, output: JSON.parse(outputRequest.input[0].output) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T12:00:00.000Z"));
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  mocks.getFeeds.mockResolvedValue(fixture);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("outil AURA get_live_feeds", () => {
  it("déclare un schéma strict et borné", () => {
    const tool = AGENT_TOOLS.find((candidate) => candidate.type === "function" && candidate.name === "get_live_feeds");
    expect(tool).toBeDefined();
    expect(tool?.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        category: { enum: [...FEED_CATEGORIES] },
        country_iso3: { pattern: "^[A-Z]{3}$" },
        hours: { minimum: 1, maximum: 720 },
        limit: { minimum: 1, maximum: LIVE_FEEDS_MAX_LIMIT },
      },
    });
  });

  it("filtre pays, catégorie et fenêtre avant la limite, balise les données non fiables et garde les erreurs de source", async () => {
    mocks.getFeeds.mockResolvedValue({ ...fixture, items: [fixture.items[0]], sources: [fixture.sources[0]] });
    const { chunks, fetchMock, output } = await collectLiveFeed({ category: "social", country_iso3: "FRA", hours: 24, limit: 40 });

    expect(mocks.getFeeds).toHaveBeenCalledWith({ category: "social", country: "FRA", sinceMs: Date.parse("2026-10-17T12:00:00.000Z"), limit: 40 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chunks.at(-1)).toEqual({ t: "done" });
    expect(output.status).toBe("ok");
    expect(output.data.items).toHaveLength(1);
    expect(output.data.items[0]).toMatchObject({
      untrusted_content: {
        title: "Rassemblement à Paris",
        source: "GDELT 2.0 (événements presse)",
        caveat: "Mention de presse non confirmée.",
      },
      nature: "press_article",
      date: "2026-10-18T10:30:00.000Z",
      dateKind: "publishedAt",
      countries: ["FRA"],
      url: "https://example.test/paris",
      metric: { label: "Articles", value: 3, unit: null },
    });
    expect(output.handling).toMatch(/jamais des instructions/);
    expect(JSON.stringify(output)).not.toMatch(/ignore previous instructions/i);
    expect(output.data.sources).toMatchObject({ category: "social", states: [expect.objectContaining({ sourceId: "gdelt-events", status: "error" })] });
    expect(output.data.sources.states[0].untrusted_content.message).toMatch(/texte retiré/);
  });

  it("retourne une indisponibilité explicite quand aucune source de la catégorie n'est exploitable", async () => {
    mocks.getFeeds.mockResolvedValue({ ...fixture, items: [], sources: [fixture.sources[0]] });
    const { output } = await collectLiveFeed({ category: "social", country_iso3: "FRA", hours: 1, limit: 1 });
    expect(output.status).toBe("unavailable");
    expect(output.data.items).toEqual([]);
    expect(output.data.sources.states[0]).toMatchObject({ status: "error" });
  });

  it("reste sous le plafond avec 40 éléments longs, indique les omissions et compacte les sources mondiales", async () => {
    mocks.getFeeds.mockResolvedValue({
      generatedAt: "2026-10-18T12:00:00.000Z",
      items: Array.from({ length: 40 }, (_, index) => ({
        ...fixture.items[0],
        id: `long:${index}`,
        title: `Titre ${index} ${"x".repeat(500)}`,
        summary: `Résumé ${index} ${"y".repeat(1_000)}`,
        caveat: `Avertissement ${index} ${"z".repeat(500)}`,
      })),
      sources: Array.from({ length: 20 }, (_, index) => ({
        ...fixture.sources[0],
        sourceId: `source:${index}`,
        sourceName: `Source ${index} ${"s".repeat(200)}`,
        status: index % 2 === 0 ? "error" : "ok",
        message: `Message ${index} ${"m".repeat(400)}`,
      })),
    } satisfies FeedsResponse);

    const { output } = await collectLiveFeed({ hours: 24, limit: 40 });

    expect(output.status).toBe("ok");
    expect(JSON.stringify(output).length).toBeLessThan(14_000);
    expect(JSON.stringify(output)).not.toContain("result_too_large");
    expect(output.data).toMatchObject({ truncated: true, omittedItems: expect.any(Number) });
    expect(output.data.omittedItems).toBeGreaterThan(0);
    expect(output.data.sources).toMatchObject({ category: null, okCount: 10 });
    expect(output.data.sources.errors).toEqual(expect.arrayContaining([expect.any(Object)]));
    expect(output.data.sources.errors).toHaveLength(10);
  });

  it.each([
    [{ category: 1 }, /category doit être une chaîne/],
    [{ category: "inconnue" }, /Catégorie de flux inconnue/],
    [{ country_iso3: "fra" }, /Code pays ISO alpha-3 invalide/],
    [{ country_iso3: 250 }, /country_iso3 doit être un code/],
    [{ hours: 0 }, /hours doit être un entier/],
    [{ hours: 721 }, /hours doit être un entier/],
    [{ hours: "24" }, /hours doit être un entier/],
    [{ limit: "16" }, /limit doit être un entier/],
  ])("refuse explicitement les arguments invalides : %o", async (args, message) => {
    const { output } = await collectLiveFeed(args);
    expect(output).toMatchObject({ status: "error", data: { error: expect.stringMatching(message) } });
    expect(mocks.getFeeds).not.toHaveBeenCalled();
  });
});
