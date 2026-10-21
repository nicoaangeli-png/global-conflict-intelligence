/**
 * Lecture d'un flux NDJSON (une valeur JSON par ligne), tel que servi par `/api/agent`.
 * Lignes vides ou illisibles ignorées ; dernière ligne sans saut de ligne prise en compte.
 */
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (line: string): { ok: true; value: unknown } | { ok: false } => {
    try {
      return { ok: true, value: JSON.parse(line) };
    } catch {
      return { ok: false };
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        const parsed = line ? parse(line) : { ok: false as const };
        if (parsed.ok) yield parsed.value;
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    const last = buffer.trim() ? parse(buffer.trim()) : { ok: false as const };
    if (last.ok) yield last.value;
  } finally {
    reader.releaseLock();
  }
}
