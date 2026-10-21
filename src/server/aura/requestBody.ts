import "server-only";

export type BodyResult = { ok: true; text: string } | { ok: false; status: 400 | 413; error: string };

/**
 * Lit le corps texte d'une requête sans jamais dépasser `maxBytes` en mémoire.
 * `Content-Length` est vérifié d'abord ; un corps transmis par morceaux (sans
 * longueur déclarée ou avec une longueur mensongère) est interrompu dès le dépassement.
 */
export async function readBoundedText(request: Request, maxBytes: number): Promise<BodyResult> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413, error: "corps trop volumineux" };
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, error: "corps trop volumineux" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: "lecture du corps impossible" };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, status: 400, error: "corps non UTF-8" };
  }
}

/** Vérifie le type de contenu JSON (paramètres comme `charset` tolérés). */
export function isJsonContentType(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() === "application/json";
}
