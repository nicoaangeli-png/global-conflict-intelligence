import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedsResponse } from "@/types/feeds";

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
        category: { enum: ["disaster", "health", "space", "nuclear", "un", "social", "economy", "uap"] },
        country_iso3: { pattern: "^[A-Z]{3}$" },
        hours: { minimum: 1, maximum: 720 },
        limit: { minimum: 1, maximum: LIVE_FEEDS_MAX_LIMIT },
      },
    });
  });

  it("filtre pays, catégorie et fenêtre, borne la demande, nettoie les données et garde les erreurs de source", async () => {
    const { chunks, fetchMock, output } = await collectLiveFeed({ category: "social", country_iso3: "FRA", hours: 24, limit: 999 });

    expect(mocks.getFeeds).toHaveBeenCalledWith({ category: "social", country: "FRA", limit: 40 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chunks.at(-1)).toEqual({ t: "done" });
    expect(output.status).toBe("ok");
    expect(output.data.items).toHaveLength(1);
    expect(output.data.items[0]).toMatchObject({
      title: "Rassemblement à Paris",
      source: "GDELT 2.0 (événements presse)",
      nature: "press_article",
      date: "2026-10-18T10:30:00.000Z",
      dateKind: "publishedAt",
      countries: ["FRA"],
      url: "https://example.test/paris",
      caveat: "Mention de presse non confirmée.",
      metric: { label: "Articles", value: 3, unit: null },
    });
    expect(JSON.stringify(output)).not.toMatch(/ignore previous instructions/i);
    expect(output.data.sources).toEqual([
      expect.objectContaining({ sourceId: "gdelt-events", status: "error", fetchedAt: "2026-10-18T11:45:00.000Z" }),
    ]);
    expect(output.data.sources[0].message).toMatch(/texte retiré/);
  });

  it("retourne une indisponibilité explicite quand aucune source de la catégorie n'est exploitable", async () => {
    const { output } = await collectLiveFeed({ category: "social", country_iso3: "FRA", hours: 1, limit: 1 });
    expect(output.status).toBe("unavailable");
    expect(output.data.items).toEqual([]);
    expect(output.data.sources[0]).toMatchObject({ status: "error" });
  });
});
