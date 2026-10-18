import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnswerText, buildHistory } from "@/components/agent/AgentPanel";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const render = (turn: Parameters<typeof AnswerText>[0]["turn"]) => renderToStaticMarkup(createElement(AnswerText, { turn, fr: true }));
const limits = { maxMessages: 12, maxUserChars: 2000, maxAssistantChars: 12_000, maxTotalChars: 24_000 };

describe("AURA — panneau, portage Vitest sans navigateur", () => {
  it("place une citation HTTP(S) à la fin de l'affirmation et garde le lien sûr", () => {
    const content = "Selon Reuters, rien ([reuters.com](https://reuters.com/a)). Autre fait.";
    const end = content.indexOf(". Autre") + 1;
    const html = render({ id: 1, role: "assistant", content, citations: [{ start: 0, end, url: "https://reuters.com/a", title: "Reuters" }] });
    expect(html).toContain('href="https://reuters.com/a"');
    expect(html).toContain("[1]");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("](https");
    expect(html.indexOf("[1]")).toBeGreaterThan(html.indexOf("rien"));
    expect(html.indexOf("[1]")).toBeLessThan(html.indexOf("Autre fait"));
  });

  it("ignore les citations dangereuses ou hors bornes sans modifier le texte", () => {
    const html = render({ id: 1, role: "assistant", content: "Texte simple.", citations: [
      { start: 0, end: 5, url: "javascript:alert(1)", title: "dangereux" },
      { start: 0, end: 999, url: "https://example.test", title: "hors borne" },
    ] });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
    expect(html).toContain("Texte simple.");
  });

  it("numérote les sources par ordre d'apparition et réutilise le même numéro", () => {
    const html = render({ id: 1, role: "assistant", content: "Un. Deux. Trois.", citations: [
      { start: 0, end: 3, url: "https://a.test/1", title: "a" },
      { start: 4, end: 9, url: "https://b.test/2", title: "b" },
      { start: 10, end: 16, url: "https://a.test/1", title: "a" },
    ] });
    expect((html.match(/\[1\]/g) ?? [])).toHaveLength(2);
    expect((html.match(/\[2\]/g) ?? [])).toHaveLength(1);
  });

  it("n'envoie que les tours complets dans un historique borné", () => {
    const turns = Array.from({ length: 8 }, (_, index) => ([
      { id: index * 2 + 1, role: "user" as const, content: `q${index}` },
      { id: index * 2 + 2, role: "assistant" as const, content: `a${index}`, status: index === 3 ? "incomplete" as const : "complete" as const },
    ])).flat();
    const history = buildHistory(turns, "nouvelle", limits);
    expect(history).toHaveLength(11);
    expect(history.at(-1)).toEqual({ role: "user", content: "nouvelle" });
    expect(history).not.toContainEqual({ role: "assistant", content: "a3" });
    const long = buildHistory([
      { id: 1, role: "user", content: "q" }, { id: 2, role: "assistant", content: "x".repeat(11_000), status: "complete" as const },
      { id: 3, role: "user", content: "q2" }, { id: 4, role: "assistant", content: "y".repeat(11_000), status: "complete" as const },
      { id: 5, role: "user", content: "q3" }, { id: 6, role: "assistant", content: "z".repeat(11_000), status: "complete" as const },
    ], "ok", limits);
    expect(long.reduce((total, entry) => total + entry.content.length, 0)).toBeLessThanOrEqual(limits.maxTotalChars);
  });
});
