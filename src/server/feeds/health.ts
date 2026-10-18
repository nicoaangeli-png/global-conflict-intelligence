import type { LiveItem } from "@/types/feeds";
import { countriesFromHeadline } from "./countries";
import { fetchJson, FeedError, plainText, str, summaryOrNull, toIso, type FeedContext, type FeedSourceDef } from "./util";

interface WhoDon {
  Id?: string;
  DonId?: string;
  Title?: string;
  OverrideTitle?: string;
  UseOverrideTitle?: string | boolean;
  Summary?: string;
  UrlName?: string;
  PublicationDateAndTime?: string;
}

/** Disease Outbreak News de l'OMS (API OData `diseaseoutbreaknews`). */
export function parseWhoDon(raw: unknown, ctx: FeedContext): LiveItem[] {
  const rows = (raw as { value?: WhoDon[] } | null)?.value;
  if (!Array.isArray(rows)) throw new FeedError("OMS : format de réponse inattendu.");
  const items: LiveItem[] = [];
  for (const row of rows) {
    const title = plainText(String(row.UseOverrideTitle) === "True" || row.UseOverrideTitle === true ? row.OverrideTitle || row.Title : row.Title || row.OverrideTitle);
    const key = str(row.DonId) ?? str(row.Id);
    if (!title || !key) continue;
    const summary = summaryOrNull(row.Summary, 450);
    items.push({
      id: `who-don:${key}`,
      category: "health",
      nature: "official_alert",
      title,
      summary,
      url: row.DonId ? `https://www.who.int/emergencies/disease-outbreak-news/item/${encodeURIComponent(row.DonId)}` : null,
      sourceId: "who-don",
      sourceName: "OMS — Disease Outbreak News",
      publishedAt: toIso(row.PublicationDateAndTime),
      occurredAt: null,
      fetchedAt: ctx.fetchedAt,
      countries: countriesFromHeadline(title, summary),
      lat: null,
      lon: null,
      severity: null,
      metric: null,
      caveat: "Publication de l'OMS à la date indiquée ; la situation a pu évoluer depuis.",
    });
  }
  return items;
}

export const healthSources: FeedSourceDef[] = [
  {
    sourceId: "who-don",
    sourceName: "OMS — Disease Outbreak News",
    category: "health",
    homepage: "https://www.who.int/emergencies/disease-outbreak-news",
    license: "© OMS (CC BY-NC-SA 3.0 IGO)",
    ttlMs: 30 * 60_000,
    async load(ctx) {
      const params = new URLSearchParams({
        $orderby: "PublicationDateAndTime desc",
        $top: "30",
        $select: "Id,Title,OverrideTitle,UseOverrideTitle,Summary,DonId,UrlName,PublicationDateAndTime",
      });
      return parseWhoDon(await fetchJson(`https://www.who.int/api/news/diseaseoutbreaknews?${params}`), ctx);
    },
  },
];
