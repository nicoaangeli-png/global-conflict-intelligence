import "server-only";

/** Échec typé d'AURA (code stable pour le client) et délai borné annulable. */

export class AgentFailure extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function withTimeout<Value>(work: Promise<Value>, timeoutMs: number, signal: AbortSignal): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AgentFailure("tool_timeout", "tool timeout")), timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AgentFailure("aborted", "aborted"));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
