import { describe, expect, it } from "vitest";
import { readNdjson } from "@/lib/ndjson";

function stream(parts: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>) {
  const out: unknown[] = [];
  for await (const value of readNdjson(body)) out.push(value);
  return out;
}

describe("lecture NDJSON du flux AURA", () => {
  it("recompose les lignes coupées entre paquets, y compris au milieu d'un caractère accentué", async () => {
    const bytes = new TextEncoder().encode('{"t":"delta","text":"Désormais"}\n{"t":"done"}\n');
    const cut = bytes.indexOf(0xc3) + 1; // coupe « é » (2 octets) en deux
    expect(await collect(stream([bytes.slice(0, cut), bytes.slice(cut, cut + 7), bytes.slice(cut + 7)]))).toEqual([
      { t: "delta", text: "Désormais" },
      { t: "done" },
    ]);
  });

  it("ignore les lignes vides ou illisibles et lit une dernière ligne sans saut", async () => {
    const text = '\n{"t":"status","text":"Recherche"}\nnon-json\n\n{"t":"done"}';
    expect(await collect(stream([new TextEncoder().encode(text)]))).toEqual([{ t: "status", text: "Recherche" }, { t: "done" }]);
  });
});
