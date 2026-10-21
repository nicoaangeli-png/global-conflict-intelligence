import "server-only";
import type { getFeeds } from "@/server/feeds";
import type { FeedCategory, LiveItem } from "@/types/feeds";
import { MAX_TOOL_OUTPUT_CHARS } from "../config";
import { SELECTED_ISO3 } from "../context";
import { cleanText, safeHttpUrl } from "../sanitize";
import type { ToolArgs } from "./types";

/**
 * Mise en forme des flux mondiaux pour l'outil `get_live_feeds` : textes externes isolés
 * dans `untrusted_content`, dates canoniques, santé des sources, budget de taille.
 */

export const LIVE_FEEDS_DEFAULT_HOURS = 168;
export const LIVE_FEEDS_MAX_HOURS = 720;
export const LIVE_FEEDS_DEFAULT_LIMIT = 16;
export const LIVE_FEEDS_MAX_LIMIT = 40;
// Marge réservée à l'enveloppe de l'outil, au rapport de nettoyage et aux échappements JSON.
const LIVE_FEEDS_DATA_BUDGET_CHARS = MAX_TOOL_OUTPUT_CHARS - 3_000;

export function optionalBoundedInteger(args: ToolArgs, key: string, fallback: number, min: number, max: number): number | null {
  if (!Object.hasOwn(args, key)) return fallback;
  const value = args[key];
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function liveFeedDate(item: LiveItem): string | null {
  return item.occurredAt ?? item.publishedAt;
}

function canonicalLiveFeedDate(item: LiveItem): string | null {
  const date = liveFeedDate(item);
  const time = date ? Date.parse(date) : Number.NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function compactLiveFeed(item: LiveItem) {
  const date = canonicalLiveFeedDate(item);
  return {
    untrusted_content: {
      title: cleanText(item.title, 180),
      summary: item.summary ? cleanText(item.summary, 220) : null,
      source: cleanText(item.sourceName, 96),
      caveat: item.caveat ? cleanText(item.caveat, 160) : null,
    },
    nature: item.nature,
    date,
    dateKind: item.occurredAt ? "occurredAt" : item.publishedAt ? "publishedAt" : null,
    countries: item.countries.filter((country) => SELECTED_ISO3.test(country)).slice(0, 8),
    url: safeHttpUrl(item.url) ?? undefined,
    metric: item.metric
      ? { label: cleanText(item.metric.label, 80), value: item.metric.value, unit: item.metric.unit ? cleanText(item.metric.unit, 32) : null }
      : null,
  };
}

function compactFeedSource(source: Awaited<ReturnType<typeof getFeeds>>["sources"][number]) {
  return {
    sourceId: cleanText(source.sourceId, 64),
    status: source.status,
    health: source.health ?? null,
    lastSuccessAt: source.lastSuccessAt ?? null,
    newestDataAt: source.newestDataAt ?? null,
    untrusted_content: {
      source: cleanText(source.sourceName, 80),
      message: source.message ? cleanText(source.message, 96) : null,
    },
  };
}

function compactLiveFeedSources(response: Awaited<ReturnType<typeof getFeeds>>, category: FeedCategory | undefined) {
  const scoped = category ? response.sources.filter((source) => source.category === category) : response.sources;
  if (category) return { category, states: scoped.map(compactFeedSource) };
  return {
    category: null,
    errors: scoped.filter((source) => source.status === "error" || source.health === "unavailable").map(compactFeedSource),
    degraded: scoped.filter((source) => source.health === "stale" || source.health === "degraded").map(compactFeedSource),
    okCount: scoped.filter((source) => source.status === "ok").length,
  };
}

export function boundedLiveFeedData(
  response: Awaited<ReturnType<typeof getFeeds>>,
  category: FeedCategory | undefined,
  countryIso3: string,
  hours: number,
  items: LiveItem[],
) {
  const data = {
    category: category ?? null,
    countryIso3: countryIso3 || null,
    hours,
    generatedAt: response.generatedAt,
    items: [] as ReturnType<typeof compactLiveFeed>[],
    truncated: false,
    omittedItems: 0,
    sources: compactLiveFeedSources(response, category),
    note: "Les dates sont celles de l'événement ou de la publication selon dateKind. Un article de presse est non confirmé ; un signalement UAP publié n'établit pas le fait signalé ; une cotation Yahoo est indicative, non officielle et différée.",
  };
  for (const item of items) {
    data.items.push(compactLiveFeed(item));
    if (JSON.stringify(data).length > LIVE_FEEDS_DATA_BUDGET_CHARS) {
      data.items.pop();
      break;
    }
  }
  data.truncated = data.items.length < items.length;
  data.omittedItems = items.length - data.items.length;
  return data;
}
