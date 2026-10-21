import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ effect: null as (() => (() => void)) | null, setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("react", () => ({
  useEffect: (effect: () => (() => void)) => { hooks.effect = effect; },
  useState: (initial: unknown) => { const setter = vi.fn(); hooks.setters.push(setter); return [initial, setter]; },
}));
import { DETECTION_POLL_MS, DETECTION_TIMEOUT_MS, useDetection } from "@/components/detection/useDetection";

describe("detection polling lifecycle", () => {
  let documentStub: EventTarget & { hidden: boolean };
  let cleanup: (() => void) | undefined;
  const response = { generatedAt: "2026-10-20T10:00:00Z", status: "ok", events: [], live: [] };
  const success = () => Promise.resolve({ ok: true, json: async () => response });

  beforeEach(() => {
    vi.useFakeTimers();
    documentStub = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", documentStub);
    hooks.setters = [];
    hooks.effect = null;
  });
  afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });
  function mount() { useDetection(); cleanup = hooks.effect!(); }

  it("fetches only the aggregate endpoint at a bounded 30 second cadence", async () => {
    const fetchStub = vi.fn(success);
    vi.stubGlobal("fetch", fetchStub);
    mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchStub).toHaveBeenCalledWith("/api/detection", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
    expect(hooks.setters[0]).toHaveBeenCalledWith(response);
    await vi.advanceTimersByTimeAsync(DETECTION_POLL_MS - 1);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("aborts a hidden request, never overlaps and resumes after visibility", async () => {
    let finish: ((value: unknown) => void) | undefined;
    const fetchStub = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchStub);
    mount();
    const signal = (fetchStub.mock.calls as unknown as [string, RequestInit][])[0][1].signal!;
    documentStub.hidden = true;
    documentStub.dispatchEvent(new Event("visibilitychange"));
    expect(signal.aborted).toBe(true);
    documentStub.hidden = false;
    documentStub.dispatchEvent(new Event("visibilitychange"));
    expect(fetchStub).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    finish!({ ok: true, json: async () => response });
    await vi.advanceTimersByTimeAsync(0);
    expect(hooks.setters[0]).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DETECTION_POLL_MS);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it("does not fetch while hidden and aborts and removes polling on unmount", async () => {
    const fetchStub = vi.fn(success);
    vi.stubGlobal("fetch", fetchStub);
    documentStub.hidden = true;
    mount();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetchStub).not.toHaveBeenCalled();
    documentStub.hidden = false;
    documentStub.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    cleanup!(); cleanup = undefined;
    await vi.advanceTimersByTimeAsync(90_000);
    documentStub.dispatchEvent(new Event("visibilitychange"));
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("times out a stalled request and retains prior data on failure", async () => {
    const fetchStub = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    vi.stubGlobal("fetch", fetchStub);
    mount();
    await vi.advanceTimersByTimeAsync(DETECTION_TIMEOUT_MS);
    expect(hooks.setters[1]).toHaveBeenCalledWith(true);
    expect(hooks.setters[0]).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DETECTION_POLL_MS);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    cleanup!(); cleanup = undefined;
    await vi.advanceTimersByTimeAsync(0);
    expect(hooks.setters[1]).toHaveBeenCalledTimes(1);
  });

  it("aborts an active request on unmount and ignores its late response", async () => {
    let finish: ((value: unknown) => void) | undefined;
    const fetchStub = vi.fn((_url: string, _options: RequestInit) => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchStub);
    mount();
    const signal = fetchStub.mock.calls[0][1].signal!;
    cleanup!(); cleanup = undefined;
    expect(signal.aborted).toBe(true);
    finish!({ ok: true, json: async () => response });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(hooks.setters[0]).not.toHaveBeenCalled();
    expect(hooks.setters[1]).not.toHaveBeenCalled();
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed and unavailable responses without clearing previous data on HTTP failure", async () => {
    const fetchStub = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...response, status: "unavailable" }) })
      .mockResolvedValueOnce({ ok: false });
    vi.stubGlobal("fetch", fetchStub);
    mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(hooks.setters[0]).not.toHaveBeenCalled();
    expect(hooks.setters[1]).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(DETECTION_POLL_MS);
    expect(hooks.setters[0]).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DETECTION_POLL_MS);
    expect(hooks.setters[0]).toHaveBeenCalledTimes(1);
    expect(hooks.setters[1]).toHaveBeenLastCalledWith(true);
  });
});
