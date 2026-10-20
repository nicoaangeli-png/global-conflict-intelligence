import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ synthesizeSpeech: vi.fn() }));

vi.mock("@/server/voice", () => ({
  VOICE_OPTIONS: [],
  defaultVoice: () => "nova",
  voiceConfigured: () => true,
  voiceModel: () => "gpt-4o-mini-tts",
  voiceLimits: () => ({ maxChars: 1200, maxCharsPerDay: 100, perMinute: 30, bodyBytes: 16_000 }),
  synthesizeSpeech: mocks.synthesizeSpeech,
}));

import { POST } from "@/app/api/agent/voice/route";
import { MemoryRateLimitStore, setRateLimitStore } from "@/server/aura/rateLimit";

const headers = { Host: "localhost:3005", Origin: "http://localhost:3005", "Content-Type": "application/json", "X-Orbital-Client": "aura" };
const speak = (text: string) => new Request("http://localhost:3005/api/agent/voice", { method: "POST", headers, body: JSON.stringify({ text }) });

beforeEach(() => setRateLimitStore(new MemoryRateLimitStore()));
afterEach(() => vi.clearAllMocks());

describe("route vocale AURA — mêmes garde-fous que l'analyse", () => {
  it("refuse une origine tierce sans appeler OpenAI", async () => {
    const response = await POST(new Request("http://localhost:3005/api/agent/voice", { method: "POST", headers: { ...headers, Origin: "https://evil.example" }, body: "{}" }));
    expect(response.status).toBe(403);
    expect(mocks.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it("refuse un corps transmis par morceaux trop volumineux", async () => {
    const chunk = new TextEncoder().encode("x".repeat(8_000));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({ pull: (controller) => (sent++ < 10 ? controller.enqueue(chunk) : controller.close()) });
    const response = await POST(new Request("http://localhost:3005/api/agent/voice", { method: "POST", headers, body, duplex: "half" } as RequestInit));
    expect(response.status).toBe(413);
    expect(mocks.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it("rend les caractères au budget quand OpenAI échoue, sans renvoyer son détail", async () => {
    mocks.synthesizeSpeech.mockResolvedValueOnce({ error: { code: "http_400", status: 502, message: "Requête vocale refusée." } });
    const failed = await POST(speak("x".repeat(80)));
    expect(failed.status).toBe(502);
    mocks.synthesizeSpeech.mockResolvedValueOnce({ body: new Blob(["mp3"]).stream(), contentType: "audio/mpeg" });
    const ok = await POST(speak("y".repeat(80)));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("mp3");
    // Budget de 100 caractères : 80 consommés, 30 de plus dépassent.
    expect((await POST(speak("z".repeat(30)))).status).toBe(429);
  });
});
