import "server-only";
import { MAX_SSE_BUFFER_CHARS } from "./config";
import { AgentFailure } from "./errors";

/** Lecture du flux SSE de l'API Responses : tampon borné, délai d'inactivité, annulation. */

export type StreamEvent = Record<string, unknown> & { type?: string };

function parseSseBlock(block: string): StreamEvent | null {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return null;
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === "object" ? (parsed as StreamEvent) : null;
  } catch {
    return null;
  }
}

function readWithIdleTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, idleMs: number, signal: AbortSignal) {
  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AgentFailure("aborted", "aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      reject(new AgentFailure("idle_timeout", "stream idle"));
    }, idleMs);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export async function* readSse(body: ReadableStream<Uint8Array>, idleMs: number, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const result = await readWithIdleTimeout(reader, idleMs, signal);
      if (result.done) break;
      buffer = (buffer + decoder.decode(result.value, { stream: true })).replace(/\r\n/g, "\n");
      if (buffer.length > MAX_SSE_BUFFER_CHARS) throw new AgentFailure("protocol", "sse buffer overflow");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const event = parseSseBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) yield event;
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    const rest = parseSseBlock(buffer.replace(/\r\n/g, "\n").trim());
    if (rest) yield rest;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
