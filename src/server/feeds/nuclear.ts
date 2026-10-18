import type { LiveItem } from "@/types/feeds";
import { countriesFromHeadline } from "./countries";
import { fetchText, parseRss, summaryOrNull, type FeedContext, type FeedSourceDef } from "./util";

/** Flux RSS de World Nuclear News (média spécialisé du secteur nucléaire civil). */
export function parseWnn(xml: string, ctx: FeedContext): LiveItem[] {
  return parseRss(xml)
    .slice(0, 40)
    .map((entry) => {
      const summary = summaryOrNull(entry.description, 350);
      return {
        id: `wnn:${entry.guid ?? entry.link ?? entry.title}`,
        category: "nuclear" as const,
        nature: "press_article" as const,
        title: entry.title,
        summary,
        url: entry.link,
        sourceId: "wnn",
        sourceName: "World Nuclear News",
        publishedAt: entry.pubDate,
        occurredAt: null,
        fetchedAt: ctx.fetchedAt,
        countries: countriesFromHeadline(entry.title, summary),
        lat: null,
        lon: null,
        severity: null,
        metric: null,
        caveat: "Article de presse spécialisée du secteur nucléaire civil, non vérifié indépendamment ; ce n'est pas une source officielle.",
      };
    });
}

export const nuclearSources: FeedSourceDef[] = [
  {
    sourceId: "wnn",
    sourceName: "World Nuclear News",
    category: "nuclear",
    homepage: "https://www.world-nuclear-news.org",
    license: "© World Nuclear Association (titres et résumés, lien vers l'original)",
    ttlMs: 20 * 60_000,
    async load(ctx) {
      return parseWnn(await fetchText("https://www.world-nuclear-news.org/rss", { accept: "application/rss+xml, application/xml" }), ctx);
    },
  },
];
