import type { LiveItem } from "@/types/feeds";
import { countriesFromHeadline } from "./countries";
import { fetchText, parseRss, summaryOrNull, type FeedContext, type FeedSourceDef } from "./util";

interface UnFlavor {
  sourceId: string;
  sourceName: string;
  caveat: string;
}

function parseUnRss(xml: string, ctx: FeedContext, flavor: UnFlavor): LiveItem[] {
  return parseRss(xml)
    .slice(0, 40)
    .map((entry) => {
      const summary = summaryOrNull(entry.description, 380);
      // Le lien « feed/view » de UN News est un détour technique : le guid pointe vers l'article.
      const url = entry.guid && /^https?:\/\//.test(entry.guid) ? entry.guid : entry.link;
      return {
        id: `${flavor.sourceId}:${entry.guid ?? entry.link ?? entry.title}`,
        category: "un" as const,
        nature: "official_publication" as const,
        title: entry.title,
        summary,
        url,
        sourceId: flavor.sourceId,
        sourceName: flavor.sourceName,
        publishedAt: entry.pubDate,
        occurredAt: null,
        fetchedAt: ctx.fetchedAt,
        countries: countriesFromHeadline(entry.title, summary),
        lat: null,
        lon: null,
        severity: null,
        metric: null,
        caveat: flavor.caveat,
      };
    });
}

/** ONU Info (UN News, français). */
export const parseUnNews = (xml: string, ctx: FeedContext) =>
  parseUnRss(xml, ctx, {
    sourceId: "un-news",
    sourceName: "ONU Info (UN News)",
    caveat: "Article du service d'information des Nations Unies : reflète la position de l'ONU.",
  });

/** Couverture des réunions (dont Conseil de sécurité) et communiqués, press.un.org (anglais). */
export const parseUnPress = (xml: string, ctx: FeedContext) =>
  parseUnRss(xml, ctx, {
    sourceId: "un-press",
    sourceName: "ONU — Couverture des réunions et communiqués",
    caveat: "Compte rendu officiel de l'ONU (en anglais) : résume les déclarations faites en séance, sans les valider.",
  });

export const unSources: FeedSourceDef[] = [
  {
    sourceId: "un-news",
    sourceName: "ONU Info (UN News)",
    category: "un",
    homepage: "https://news.un.org/fr",
    license: "© Nations Unies (reproduction autorisée avec mention de la source)",
    ttlMs: 10 * 60_000,
    async load(ctx) {
      return parseUnNews(await fetchText("https://news.un.org/feed/subscribe/fr/news/all/rss.xml", { accept: "application/rss+xml, application/xml" }), ctx);
    },
  },
  {
    sourceId: "un-press",
    sourceName: "ONU — Couverture des réunions et communiqués",
    category: "un",
    homepage: "https://press.un.org",
    license: "© Nations Unies",
    ttlMs: 10 * 60_000,
    async load(ctx) {
      return parseUnPress(await fetchText("https://press.un.org/en/rss.xml", { accept: "application/rss+xml, application/xml" }), ctx);
    },
  },
];
