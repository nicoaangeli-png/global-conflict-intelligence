import { describe, expect, it } from "vitest";
import { parseFrankfurter, parseYahooIndex, STOCK_INDICES } from "@/server/feeds/economy";
import { parseWhoDon } from "@/server/feeds/health";
import { parseWnn } from "@/server/feeds/nuclear";
import { parseLl2 } from "@/server/feeds/space";
import { parseUnNews, parseUnPress } from "@/server/feeds/un";
import { ctx, fixtureJson, fixtureText } from "./feeds-helpers";

const noMarkup = (text: string | null) => !text || !/<[a-z/!]|&[a-z#0-9]+;/i.test(text);

describe("OMS Disease Outbreak News", () => {
  const items = parseWhoDon(fixtureJson("who-don.json"), ctx());

  it("lit titre, résumé, date de publication et lien officiel", () => {
    expect(items).toHaveLength(5);
    const mers = items[0];
    expect(mers.title).toBe("Middle East respiratory syndrome coronavirus - Kingdom of Saudi Arabia");
    expect(mers.nature).toBe("official_alert");
    expect(mers.publishedAt).toBe("2026-10-15T16:00:00.000Z");
    expect(mers.occurredAt).toBeNull();
    expect(mers.url).toBe("https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON618");
    expect(mers.severity).toBeNull();
    expect(mers.countries).toEqual(["SAU"]);
  });

  it("rattache les pays nommés dans le titre", () => {
    expect(items.find((i) => i.title.includes("Russian Federation"))?.countries).toEqual(["RUS"]);
    expect(items.find((i) => i.title.includes("Democratic Republic of the Congo"))?.countries).toEqual(["COD"]);
  });

  it("rejette un format inattendu", () => {
    expect(() => parseWhoDon({}, ctx())).toThrow(/OMS/);
  });
});

describe("Launch Library 2", () => {
  const upcoming = parseLl2(fixtureJson("ll2-upcoming.json"), ctx(), "upcoming");
  const previous = parseLl2(fixtureJson("ll2-previous.json"), ctx(), "previous");

  it("événement planifié daté par NET, pays du site de lancement", () => {
    expect(upcoming).toHaveLength(3);
    const first = upcoming[0];
    expect(first.nature).toBe("scheduled_event");
    expect(first.occurredAt).toBe("2026-10-19T10:30:00.000Z");
    expect(first.countries).toEqual(["USA"]);
    expect(first.lat).toBeCloseTo(28.56, 1);
    expect(first.caveat).toMatch(/NET/);
    expect(first.title).toContain("Bandwagon 5");
    expect(noMarkup(first.summary)).toBe(true);
  });

  it("distingue lancements passés", () => {
    expect(previous).toHaveLength(2);
    expect(previous[0].caveat).toMatch(/passé/);
    expect(previous[0].publishedAt).toMatch(/Z$/);
  });

  it("rejette un format inattendu", () => {
    expect(() => parseLl2({ detail: "Request was throttled." }, ctx(), "upcoming")).toThrow(/Launch Library/);
  });
});

describe("World Nuclear News", () => {
  const items = parseWnn(fixtureText("wnn.rss"), ctx());

  it("articles de presse sans HTML ni entités", () => {
    expect(items).toHaveLength(6);
    for (const i of items) {
      expect(i.nature).toBe("press_article");
      expect(i.caveat).toMatch(/non vérifié|presse/);
      expect(noMarkup(i.title)).toBe(true);
      expect(noMarkup(i.summary)).toBe(true);
      expect(i.url).toMatch(/^https:\/\/www\.world-nuclear-news\.org\/articles\//);
    }
  });

  it("décode les entités accentuées et attribue les pays avec prudence", () => {
    const poland = items.find((i) => i.title.includes("Poland"));
    expect(poland?.summary).toContain("Pątnów");
    expect(poland?.countries).toEqual(["POL"]);
    expect(items.find((i) => i.title.startsWith("Multiple milestones for India"))?.countries).toEqual(["IND"]);
  });

  it("refuse un contenu qui n'est pas du RSS", () => {
    expect(() => parseWnn("<html><body>Cloudflare</body></html>", ctx())).toThrow(/RSS/);
  });
});

describe("ONU", () => {
  it("UN News en français : lien d'article (guid), date convertie en UTC", () => {
    const items = parseUnNews(fixtureText("un-news.rss"), ctx());
    expect(items).toHaveLength(4);
    expect(items[0].nature).toBe("official_publication");
    expect(items[0].url).toMatch(/^https:\/\/news\.un\.org\/fr\/story\//);
    expect(items[0].publishedAt).toBe("2026-10-16T12:00:00.000Z");
    expect(items.every((i) => noMarkup(i.title) && noMarkup(i.summary))).toBe(true);
    expect(items[0].title).toContain("Ebola");
    expect(items[0].countries).toEqual(["KEN"]);
  });

  it("press.un.org : comptes rendus du Conseil de sécurité", () => {
    const items = parseUnPress(fixtureText("un-press.rss"), ctx());
    expect(items).toHaveLength(4);
    const sudan = items.find((i) => i.title.includes("Sudan"));
    expect(sudan?.countries).toEqual(["SDN"]);
    expect(sudan?.publishedAt).toBe("2026-10-16T21:13:34.000Z");
    expect(sudan?.sourceId).toBe("un-press");
  });
});

describe("économie", () => {
  it("devises BCE : variation entre les deux derniers fixings, pays émetteur", () => {
    const items = parseFrankfurter(fixtureJson("frankfurter.json"), ctx());
    const usd = items.find((i) => i.id.startsWith("ecb-fx:USD"));
    expect(usd?.countries).toEqual(["USA"]);
    expect(usd?.nature).toBe("market_quote");
    expect(usd?.metric?.unit).toBe("%");
    expect(usd?.caveat).toMatch(/BCE/);
    const raw = fixtureJson("frankfurter.json");
    const days = Object.keys(raw.rates).sort();
    const expected = ((raw.rates[days[2]].USD - raw.rates[days[1]].USD) / raw.rates[days[1]].USD) * 100;
    expect(usd?.metric?.value).toBeCloseTo(expected, 2);
    expect(usd?.id.endsWith(days[2])).toBe(true);
  });

  it("indice boursier : variation entre séances, date de séance réelle, caveat Yahoo", () => {
    const def = STOCK_INDICES.find((s) => s.iso3 === "FRA") as (typeof STOCK_INDICES)[number];
    const item = parseYahooIndex(fixtureJson("yahoo-fchi.json"), def, ctx());
    expect(item).not.toBeNull();
    expect(item?.countries).toEqual(["FRA"]);
    expect(item?.caveat).toBe("Cotation via Yahoo Finance (source non officielle, différée).");
    expect(item?.summary).toMatch(/séance du \d{4}-\d{2}-\d{2}/);
    expect(item?.metric?.label).toMatch(/Variation/);
    expect(Math.abs(item?.metric?.value ?? 99)).toBeLessThan(20);
  });

  it("une seule séance disponible : pas de variation inventée", () => {
    const def = STOCK_INDICES.find((s) => s.iso3 === "SAU") as (typeof STOCK_INDICES)[number];
    const item = parseYahooIndex(fixtureJson("yahoo-tasi.json"), def, ctx());
    expect(item?.metric).toBeNull();
    expect(item?.severity).toBeNull();
  });

  it("symbole introuvable : null", () => {
    const def = STOCK_INDICES[0];
    expect(parseYahooIndex(fixtureJson("yahoo-notfound.json"), def, ctx())).toBeNull();
  });

  it("table des indices : ISO3 et symboles uniques", () => {
    expect(STOCK_INDICES.length).toBeGreaterThanOrEqual(35);
    expect(new Set(STOCK_INDICES.map((s) => s.iso3)).size).toBe(STOCK_INDICES.length);
    expect(new Set(STOCK_INDICES.map((s) => s.symbol)).size).toBe(STOCK_INDICES.length);
    expect(STOCK_INDICES.every((s) => /^[A-Z]{3}$/.test(s.iso3))).toBe(true);
  });
});
