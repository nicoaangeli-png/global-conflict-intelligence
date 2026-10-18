import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectFacts, dateLabelFr, domainOf, passesGuardrail } from "@/server/briefing/collect";
import { clusterStories, hasRealTitle, profileOf, sameStory, stripOutlet } from "@/server/briefing/stories";
import type { ConflictEvent } from "@/types/conflict";
import type { FeedsResponse } from "@/types/feeds";

const load = <T>(name: string): T => JSON.parse(readFileSync(path.join(__dirname, "fixtures", "briefing", name), "utf8"));
export const NOW = Date.parse("2026-10-18T10:00:00.000Z"); // dimanche
const deps = (feeds = load<FeedsResponse>("feeds.json"), events = load<ConflictEvent[]>("conflicts.json")) => ({
  getFeeds: async () => feeds,
  getConflictEvents: async () => events,
  now: () => NOW,
});
const cand = (title: string, url: string, countries = ["FRA"]) => ({ title, url, countries });

describe("garde-fous de collecte", () => {
  it("domaines indépendants", () => {
    expect(domainOf("https://www.bbc.co.uk/b")).toBe("bbc.co.uk");
    expect(domainOf("https://a.lemonde.fr/x")).toBe("lemonde.fr");
    expect(passesGuardrail([{ name: "a", url: "https://x.com/1", date: null, official: false }, { name: "b", url: "https://x.com/2", date: null, official: false }])).toBe(false);
    expect(passesGuardrail([{ name: "a", url: "https://x.com/1", date: null, official: false }], true)).toBe(true);
  });

  it("officiel seul accepté, presse seule refusée", async () => {
    const { facts } = await collectFacts(deps());
    expect(facts.disasters).toHaveLength(1);
    expect(facts.politics).toHaveLength(1);
    expect(facts.space).toHaveLength(0);
    const wnnOnly = facts.nuclear.filter((f) => f.nature === "press_article");
    expect(wnnOnly).toHaveLength(0); // WNN : un seul média
  });

  it("fenêtre 24 h, dédoublonnage séisme GDACS/USGS", async () => {
    const { facts } = await collectFacts(deps());
    expect(facts.disasters[0].sources.map((s) => s.name).sort()).toEqual(["GDACS (ONU / Commission européenne)", "USGS"]);
    expect(facts.disasters.some((f) => f.title.includes("ancien"))).toBe(false);
  });

  it("bornage à 8 faits et ids stables ; une source en panne n'efface pas le reste", async () => {
    const feeds = load<FeedsResponse>("feeds.json");
    const base = feeds.items.find((i) => i.id === "gdacs:eq1")!;
    feeds.items = Array.from({ length: 12 }, (_, i) => ({ ...base, id: `g:${i}`, title: `Alerte ${i}`, lat: null, lon: null, metric: null }));
    const { facts } = await collectFacts(deps(feeds));
    expect(facts.disasters).toHaveLength(8);
    expect(facts.disasters[0].id).toBe("cat-1");
    const res = await collectFacts({ ...deps(), getFeeds: async () => { throw new Error("x"); } });
    expect(res.facts.conflicts.length).toBe(2);
    expect(res.notes).toContain("flux mondiaux indisponibles");
  });
});

describe("presse = histoires, pas pays", () => {
  it("vrai positif : même histoire, 2 domaines, avec suffixe média ôté", () => {
    const a = profileOf("Affrontements à Limoges entre manifestants et policiers");
    const b = profileOf("Limoges : affrontements entre manifestants et forces de l'ordre - BBC News");
    expect(sameStory(a, b)).toBe(true);
    expect(profileOf("Titre - BBC News").tokens.has("bbc")).toBe(false);
    expect(stripOutlet("Arab News | 'Serious incident' at Canada base")).toBe("'Serious incident' at Canada base");
  });

  it("faux positif évité : même ville et même mot-clé, histoires différentes", () => {
    expect(sameStory(profileOf("Paris : manifestation contre la réforme des retraites"), profileOf("Paris : incendie dans un entrepôt, manifestation de riverains"))).toBe(false);
    expect(sameStory(profileOf("Grève des transports à Paris"), profileOf("Incendie à Paris : trois blessés"))).toBe(false);
  });

  it("faux positif évité : majuscules de début de phrase / casse Title Case ne font pas des noms propres", () => {
    const a = profileOf("Foreign nationals protesting in India a concern: Chirag Paswan targets Imran Khan");
    const b = profileOf("Trump administration recognises significance of India as strategic partner: Foreign affairs expert ahead of Rubio's visit");
    expect(sameStory(a, b)).toBe(false);
    const c = profileOf("States Must Reaffirm Commitment to International Humanitarian Law as Conflict Evolves");
    expect(c.entities.size).toBe(0);
  });

  it("deux articles du même domaine ne font pas une histoire ; pays disjoints jamais", () => {
    const same = clusterStories([cand("Grève générale à Lagos : syndicats", "https://www.punchng.com/1", ["NGA"]), cand("Grève générale à Lagos : syndicats paralysent", "https://www.punchng.com/2", ["NGA"])]);
    expect(same).toHaveLength(0);
    const apart = clusterStories([cand("Grève générale des syndicats paralyse la ville", "https://a.com/1", ["NGA"]), cand("Grève générale des syndicats paralyse la ville", "https://b.com/1", ["FRA"])]);
    expect(apart).toHaveLength(0);
  });

  it("titre absent (simple domaine) inutilisable", () => {
    expect(hasRealTitle("lemonde.fr", "https://www.lemonde.fr/h")).toBe(false);
    expect(hasRealTitle("Affrontements à Limoges entre manifestants", "https://www.lemonde.fr/h")).toBe(true);
  });

  it("société : une seule histoire retenue, avec titres et sans bilan humain", async () => {
    const { facts } = await collectFacts(deps());
    expect(facts.society).toHaveLength(1);
    const f = facts.society[0];
    expect(f.nature).toBe("press_article");
    expect(f.independentSources).toBe(2);
    expect(f.headlines).toEqual(["Affrontements à Limoges entre manifestants et policiers", "Limoges : affrontements entre manifestants et forces de l'ordre"]);
    expect(f.sources.every((s) => !s.official && s.title)).toBe(true);
    expect(f.casualtiesAllowed).toBe(false);
    expect(f.fatalities).toBeNull();
    expect(f.lat).toBeCloseTo(45.83);
  });

  it("conflits : UCDP officiel d'abord, histoire GDELT par titres, article sans titre écarté", async () => {
    const { facts } = await collectFacts(deps());
    expect(facts.conflicts).toHaveLength(2);
    expect(facts.conflicts[0].nature).toBe("conflict_record");
    expect(facts.conflicts[0].fatalities).toBe(14);
    const story = facts.conflicts[1];
    expect(story.headlines[0]).toMatch(/Khartoum/);
    expect(story.independentSources).toBe(2);
    expect(story.fatalities).toBeNull();
  });
});

describe("fenêtres honnêtes (dimanche : rien de l'ONU depuis vendredi)", () => {
  it("dateLabelFr", () => {
    expect(dateLabelFr("2026-10-16T09:00:00.000Z")).toBe("vendredi 16 octobre");
  });

  it("politique élargie à 72 h, santé à 7 jours, autres chapitres restent à 24 h", async () => {
    const { facts, windowHours } = await collectFacts(deps());
    expect(windowHours.politics).toBe(72);
    expect(facts.politics[0].dateLabel).toBe("vendredi 16 octobre");
    expect(windowHours.health).toBe(168);
    expect(facts.health[0].dateLabel).toBe("lundi 12 octobre");
    expect(windowHours.disasters).toBe(24);
    expect(windowHours.space).toBe(24);
  });

  it("si le chapitre a des faits à 24 h, la fenêtre n'est pas élargie", async () => {
    const feeds = load<FeedsResponse>("feeds.json");
    feeds.items.find((i) => i.id === "un-news:1")!.publishedAt = "2026-10-18T08:00:00.000Z";
    const { windowHours } = await collectFacts(deps(feeds));
    expect(windowHours.politics).toBe(24);
  });

  it("chapitre vide même élargi : fenêtre maximale annoncée", async () => {
    const feeds = load<FeedsResponse>("feeds.json");
    feeds.items = feeds.items.filter((i) => i.category !== "health");
    const { facts, windowHours } = await collectFacts(deps(feeds));
    expect(facts.health).toHaveLength(0);
    expect(windowHours.health).toBe(168);
  });
});

describe("économie et nucléaire", () => {
  it("indice boursier ≥ 1,5 % admis comme mesure non officielle ; variation faible écartée", async () => {
    const { facts, windowHours } = await collectFacts(deps());
    expect(windowHours.economy).toBe(72);
    expect(facts.economy).toHaveLength(1);
    const f = facts.economy[0];
    expect(f.title).toMatch(/CAC 40/);
    expect(f.unofficialSource).toBe("Yahoo Finance");
    expect(f.sources[0].official).toBe(false);
    expect(f.dateLabel).toBe("vendredi 16 octobre");
  });

  it("publication ONU sur le nucléaire routée vers le chapitre nucléaire (pas vers la politique)", async () => {
    const { facts, windowHours } = await collectFacts(deps());
    expect(facts.nuclear).toHaveLength(1);
    expect(facts.nuclear[0].title).toMatch(/AIEA/);
    expect(facts.nuclear[0].sources[0].official).toBe(true);
    expect(windowHours.nuclear).toBe(72);
    expect(facts.politics.some((f) => /AIEA/.test(f.title))).toBe(false);
  });
});
