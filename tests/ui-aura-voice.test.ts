import { describe, expect, it } from "vitest";
import { speakable } from "@/components/agent/useAuraVoice";

/** La voix d'AURA ne lit jamais le markdown, les marqueurs [n] ni les URL. */
describe("speakable", () => {
  it("retire marqueurs de citation, liens et URL", () => {
    expect(speakable("Le cessez-le-feu tient [1][2], selon l'ONU [3, 4] (https://news.un.org/fr/story/1).")).toBe("Le cessez-le-feu tient, selon l'ONU.");
    expect(speakable("Voir [ONU Info](https://news.un.org) et www.reuters.com/world aujourd'hui.")).toBe("Voir ONU Info et aujourd'hui.");
    expect(speakable("Source : <https://example.org/a?b=c>")).toBe("Source :");
  });

  it("retire le markdown (titres, gras, listes, code, tableaux)", () => {
    const text = "## Point de situation\n**Kharkiv** : frappes *nocturnes*.\n- premier point\n1. second point\n`code`\n| a | b |\n|---|---|";
    expect(speakable(text)).toBe("Point de situation Kharkiv : frappes nocturnes. premier point second point code, a, b,");
  });

  it("garde les nombres et la ponctuation utiles", () => {
    expect(speakable("Bilan : 12 morts le 18/10/2026.")).toBe("Bilan : 12 morts le 18/10/2026.");
  });
});
