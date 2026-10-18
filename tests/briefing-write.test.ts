import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { collectFacts } from "@/server/briefing/collect";
import { enforceMentions, templateSentences, validateSentences, writeChapters } from "@/server/briefing/write";
import type { ConflictEvent } from "@/types/conflict";
import type { FeedsResponse } from "@/types/feeds";

const load = <T>(name: string): T => JSON.parse(readFileSync(path.join(__dirname, "fixtures", "briefing", name), "utf8"));
const collected = async () =>
  await collectFacts({ getFeeds: async () => load<FeedsResponse>("feeds.json"), getConflictEvents: async () => load<ConflictEvent[]>("conflicts.json"), now: () => Date.parse("2026-10-18T10:00:00.000Z") });
const facts = async () => (await collected()).facts;

const openAi = (chapters: unknown) =>
  vi.fn(async () => new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ chapters }) }] }] }), { status: 200 }));

describe("rédaction", () => {
  it("retire les phrases sans factId valide, avec URL, ou avec bilan tiré de la presse", async () => {
    const f = await facts();
    const press = f.society[0].id;
    const out = validateSentences(
      [
        { text: "Un séisme a frappé le Japon.", factIds: [f.disasters[0].id] },
        { text: "Phrase orpheline.", factIds: [] },
        { text: "Phrase à id inconnu.", factIds: ["zzz-9"] },
        { text: "Voir https://exemple.org/x pour le détail.", factIds: [f.disasters[0].id] },
        { text: "Douze morts selon des témoins.", factIds: [press] },
        { text: "**Quatorze morts** selon l'UCDP.", factIds: [f.conflicts[0].id] },
      ],
      [...f.disasters, ...f.society, ...f.conflicts],
    );
    expect(out.map((x) => x.text)).toEqual(["Un séisme a frappé le Japon.", "Quatorze morts selon l'UCDP."]);
  });

  it("fenêtre élargie : la phrase est datée automatiquement si le modèle l'oublie", async () => {
    const c = await collected();
    const pol = c.facts.politics;
    const [undated, dated] = validateSentences(
      [
        { text: "Le Conseil de sécurité a adopté une résolution sur le Soudan.", factIds: [pol[0].id] },
        { text: "Vendredi 16 octobre, le Conseil de sécurité a adopté une résolution.", factIds: [pol[0].id] },
      ],
      pol,
      c.windowHours.politics,
    );
    expect(undated.text).toBe("Vendredi 16 octobre, le Conseil de sécurité a adopté une résolution sur le Soudan.");
    expect(dated.text).toBe("Vendredi 16 octobre, le Conseil de sécurité a adopté une résolution.");
    // fenêtre de 24 h : pas de préfixe
    expect(validateSentences([{ text: "Le Conseil a voté.", factIds: [pol[0].id] }], pol, 24)[0].text).toBe("Le Conseil a voté.");
  });

  it("indice Yahoo : la source non officielle est toujours nommée et la séance datée", async () => {
    const c = await collected();
    const eco = c.facts.economy;
    const [s] = validateSentences([{ text: "Le CAC 40 a perdu un virgule huit pour cent.", factIds: [eco[0].id] }], eco, c.windowHours.economy);
    expect(s.text).toMatch(/^Vendredi 16 octobre, le CAC 40/);
    expect(s.text).toMatch(/selon Yahoo Finance, source non officielle/);
    expect(enforceMentions("Selon Yahoo Finance (source non officielle), le CAC 40 recule.", eco, 24)).toBe("Selon Yahoo Finance (source non officielle), le CAC 40 recule.");
    expect(enforceMentions("Selon Yahoo Finance, le CAC 40 recule.", eco, 24)).toMatch(/\(source non officielle\)\.$/);
  });

  it("indice Yahoo : une variation exceptionnelle est signalée comme non recoupée", async () => {
    const c = await collected();
    const base = c.facts.economy[0];
    const extreme = [{ ...base, metric: { label: "Variation", value: -11.57, unit: "%" } }];
    const normal = [{ ...base, metric: { label: "Variation", value: -1.8, unit: "%" } }];
    expect(enforceMentions("Selon Yahoo Finance (source non officielle), l'IDX recule.", extreme, 24)).toMatch(/non recoupée par une seconde source\.$/);
    expect(enforceMentions("Selon Yahoo Finance (source non officielle), le CAC 40 recule.", normal, 24)).not.toMatch(/non recoup/);
  });

  it("gabarit : histoire de presse non confirmée sans bilan, fenêtre datée, indice nommé non officiel", async () => {
    const c = await collected();
    const soc = templateSentences(c.facts.society, 24)[0].text;
    expect(soc).toMatch(/^Selon 2 médias, non confirmé : Affrontements à Limoges/);
    const pol = templateSentences(c.facts.politics, 72)[0].text;
    expect(pol).toMatch(/^Vendredi 16 octobre, /);
    expect(pol).toMatch(/Source : ONU Info/);
    expect(templateSentences(c.facts.economy, 72)[0].text).toMatch(/Yahoo Finance, source non officielle/);
  });

  it("appel OpenAI mocké : json_schema strict, sans web_search, titres fournis, chapitres vides inchangés", async () => {
    const c = await collected();
    const f = c.facts;
    const fetchMock = openAi([
      { key: "disasters", sentences: [{ text: "Un séisme de magnitude six virgule quatre a frappé le Japon.", factIds: [f.disasters[0].id] }] },
      { key: "society", sentences: [{ text: "Selon plusieurs médias, des affrontements ont éclaté à Limoges.", factIds: [f.society[0].id] }] },
      { key: "conflicts", sentences: [{ text: "Sans source.", factIds: [] }] },
    ]);
    const w = await writeChapters(f, c.windowHours, { fetch: fetchMock as unknown as typeof fetch, apiKey: "k", model: undefined });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.text.format).toMatchObject({ type: "json_schema", strict: true });
    expect(body.tools).toBeUndefined();
    expect(body.input).toContain("Limoges : affrontements entre manifestants");
    expect(body.input).toContain('"windowHours":72');
    expect(w.chapters).toHaveLength(8);
    const dis = w.chapters.find((x) => x.key === "disasters")!;
    expect(dis.writer).toBe("ai");
    expect(dis.focus).toEqual({ lat: 35, lon: 139 });
    expect(dis.windowHours).toBe(24);
    expect(w.chapters.find((x) => x.key === "society")!.spokenText).toContain("Limoges");
    expect(w.chapters.find((x) => x.key === "conflicts")!.writer).toBe("template");
    expect(w.status).toBe("degraded");
    const empty = w.chapters.find((x) => x.key === "space")!;
    expect(empty.spokenText).toBe("Rien de significatif dans nos sources sur 24 h.");
    expect(empty.writer).toBe("empty");
    expect(empty.focus).toBeNull();
  });

  it("chapitre vide après élargissement : l'avertissement annonce la vraie fenêtre", async () => {
    const c = await collected();
    const facts2 = { ...c.facts, health: [] };
    const w = await writeChapters(facts2, c.windowHours, { apiKey: undefined });
    expect(w.chapters.find((x) => x.key === "health")!.spokenText).toBe("Rien de significatif dans nos sources sur 168 h.");
  });

  it("repli dégradé sans clé : gabarit factuel sourcé", async () => {
    const c = await collected();
    const w = await writeChapters(c.facts, c.windowHours, { apiKey: undefined });
    expect(w.status).toBe("degraded");
    expect(w.reason).toMatch(/clé/i);
    const dis = w.chapters.find((x) => x.key === "disasters")!;
    expect(dis.sentences[0].factIds).toHaveLength(1);
    expect(dis.spokenText).toMatch(/Source : /);
    expect(dis.spokenText).not.toMatch(/https?:/);
    expect(w.chapters.every((x) => x.spokenText.length > 0)).toBe(true);
  });

  it("repli dégradé si l'appel échoue (HTTP 500 ou JSON invalide)", async () => {
    const c = await collected();
    for (const res of [new Response("{}", { status: 500 }), new Response(JSON.stringify({ status: "completed", output_text: "pas du json" }))]) {
      const w = await writeChapters(c.facts, c.windowHours, { apiKey: "k", fetch: (async () => res) as unknown as typeof fetch });
      expect(w.status).toBe("degraded");
      expect(w.chapters.find((x) => x.key === "politics")!.writer).toBe("template");
    }
  });
});
