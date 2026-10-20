import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runAgent: vi.fn(), normalizeContext: vi.fn((value) => value), agentConfigured: vi.fn(() => true) }));

vi.mock("@/server/agent", () => ({
  agentConfigured: mocks.agentConfigured,
  agentLimits: () => ({ bodyBytes: 64_000, maxMessages: 12, maxUserChars: 2000, maxAssistantChars: 12_000, maxTotalChars: 24_000, maxConcurrent: 2, perClientConcurrent: 1, perClientPerMinute: 6, globalPerMinute: 20, dailyRequests: 300 }),
  normalizeContext: mocks.normalizeContext,
  runAgent: mocks.runAgent,
}));

import { GET, POST } from "@/app/api/agent/route";
import { MemoryRateLimitStore, setRateLimitStore } from "@/server/aura/rateLimit";

const headers = { Host: "localhost:3005", Origin: "http://localhost:3005", "Content-Type": "application/json", "X-Orbital-Client": "aura" };
const body = (messages = [{ role: "user", content: "Question ?" }]) => JSON.stringify({ messages, context: { locale: "fr" } });

function request(overrides: Record<string, string> = {}, raw = body()) {
  return new Request("http://localhost:3005/api/agent", { method: "POST", headers: { ...headers, ...overrides }, body: raw });
}

beforeEach(() => {
  setRateLimitStore(new MemoryRateLimitStore());
  mocks.runAgent.mockImplementation(async function* () { yield { t: "delta", text: "Réponse." }; yield { t: "done" }; });
});

afterEach(() => vi.clearAllMocks());

describe("route AURA — portage Vitest sans fournisseur", () => {
  it("expose les bornes publiques sans secret", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ configured: true, limits: { maxMessages: 12, maxUserChars: 2000 } });
  });

  it("refuse origine, client et type avant de lancer l'agent", async () => {
    for (const [overrides, status] of [
      [{ Origin: "https://untrusted.invalid" }, 403],
      [{ Host: "evil.example", Origin: "http://evil.example" }, 403],
      [{ "X-Orbital-Client": "" }, 403],
      [{ "Content-Type": "text/plain" }, 415],
    ] as const) {
      expect((await POST(request(overrides))).status).toBe(status);
    }
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });

  it("produit du NDJSON avec le terminal de l'agent", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const chunks = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(chunks).toEqual([{ t: "delta", text: "Réponse." }, { t: "done" }]);
    expect(mocks.runAgent).toHaveBeenCalledOnce();
  });

  it("valide le format et garantit un terminal lorsqu'un générateur s'arrête sans état", async () => {
    const thirteenMessages = Array.from({ length: 13 }, () => ({ role: "user", content: "x" }));
    const tooManyMessages = await POST(request({}, body(thirteenMessages)));
    expect(tooManyMessages.status).toBe(400);
    const lastAssistant = await POST(request({}, body([{ role: "assistant", content: "pas une question" }])));
    expect(lastAssistant.status).toBe(400);
    mocks.runAgent.mockImplementation(async function* () { yield { t: "delta", text: "partiel" }; });
    const response = await POST(request());
    const chunks = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(chunks.at(-1)).toMatchObject({ t: "error", code: "no_terminal" });
  });

  it("n'expose jamais le message d'une erreur interne au client", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.runAgent.mockImplementation(async function* () {
      yield { t: "delta", text: "début" };
      throw new Error("ECONNREFUSED /home/ubuntu/orbital/data/secret.sqlite");
    });
    const text = await (await POST(request())).text();
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("/home/");
    expect(text.trim().split("\n").map((line) => JSON.parse(line)).at(-1)).toMatchObject({ t: "error", code: "server_error" });
  });

  it("transmet un signal d'annulation à l'agent et libère la place quand le client se déconnecte", async () => {
    let seen: AbortSignal | undefined;
    mocks.runAgent.mockImplementation(async function* (_messages: unknown, _context: unknown, options: { signal?: AbortSignal }) {
      seen = options.signal;
      yield { t: "delta", text: "début" };
      await new Promise((resolve) => options.signal?.addEventListener("abort", resolve, { once: true }));
    });
    const client = new AbortController();
    const response = await POST(new Request("http://localhost:3005/api/agent", { method: "POST", headers, body: body(), signal: client.signal }));
    const reader = response.body!.getReader();
    await reader.read();
    client.abort();
    await reader.cancel();
    expect(seen?.aborted).toBe(true);
    // Place libérée : une autre question est admise immédiatement.
    mocks.runAgent.mockImplementation(async function* () { yield { t: "done" }; });
    expect((await POST(request({}, body([{ role: "user", content: "Autre question ?" }])))).status).toBe(200);
  });
});
