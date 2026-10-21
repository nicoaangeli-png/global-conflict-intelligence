import type { Signal, SignalKind } from "@/types/detection";
import type { ConflictEvent } from "@/types/conflict";
import type { LiveItem } from "@/types/feeds";
import { isRealSourceRecord } from "@/server/dataPolicy";

export function words(value: string): string[] {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(odessa)\b/g, "odesa")
    .replace(/\b(explosions?|detonations?|blasts?|de[Bb]tonations?)\b/g, "explosion")
    .replace(/\b(seismes?|earthquakes?|tremblement)\b/g, "earthquake")
    .replace(/\b(missiles?|missile strikes?)\b/g, "missile")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

export const normalized = (value: string) => words(value).join(" ");

export function safeUrl(value: string | null): string | null {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function date(value: string | null | undefined): string | null {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function classify(text: string): SignalKind {
  const value = normalized(text);
  if (/\b(earthquake|magnitude)\b/.test(value)) return "earthquake";
  if (/\b(explosion|missile|shelling|airstrike|bombardement)\b/.test(value)) return "explosion";
  if (/\b(protest|protests|manifestation|manifestations|riot|riots)\b/.test(value)) return "protest";
  if (/\b(outage|panne|blackout)\b/.test(value)) return "outage";
  return "other";
}

export function validPosition(lat: number | null, lon: number | null, precision: NonNullable<Signal["position"]>["precision"]): Signal["position"] {
  return lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { lat, lon, precision } : null;
}

export function agencyIn(text: string): string | null {
  const found = text.match(/(?:\b(?:via|source|copyright|©|by|par|according to|selon)\s*[:—-]?\s*|\()(Reuters|Associated Press|Agence France.Presse|AFP)(?:\b|\))/i);
  return found ? (/reuters/i.test(found[1]) ? "reuters" : /associated/i.test(found[1]) ? "ap" : "afp") : null;
}

export function fromFeed(item: LiveItem): Signal | null {
  if (["military", "shipping", "economy", "space", "uap"].includes(item.category)) return null;
  const occurredAt = date(item.occurredAt);
  const isUsgs = item.sourceId === "usgs" && item.nature === "sensor_measurement";
  const kind = isUsgs ? "earthquake" : item.category === "weather" ? "weather" : classify(item.title);
  return {
    id: `feed:${item.id}`, provider: item.sourceId, sourceName: item.sourceName,
    url: safeUrl(item.url), title: item.title.slice(0, 500), text: item.summary?.slice(0, 4000) ?? null,
    kind, nature: item.nature === "press_article" ? "press" : item.nature === "sensor_measurement" ? "sensor" : item.nature.startsWith("official_") ? "official" : "report",
    occurredAt, publishedAt: date(item.publishedAt), receivedAt: date(item.fetchedAt) ?? new Date().toISOString(),
    position: validPosition(item.lat, item.lon, isUsgs ? "point" : "unknown"),
    place: null, countries: item.countries, entities: [], upstreamAgency: agencyIn(`${item.title} ${item.summary ?? ""}`),
    confirmsOccurrence: isUsgs && occurredAt !== null,
    severity: item.severity, metric: item.metric, caveat: item.caveat,
  };
}

export function fromConflict(item: ConflictEvent, receivedAt: string): Signal | null {
  if (!isRealSourceRecord(item)) return null;
  const media = item.sourceDataset === "gdelt";
  const thermal = item.sourceDataset === "firms";
  const structured = ["ucdp", "acled"].includes(item.sourceDataset);
  const title = item.title?.trim() || item.subEventType?.trim() || item.eventType;
  const kind = thermal ? "thermal" : classify(`${title} ${item.eventType}`);
  return {
    id: `record:${item.sourceDataset}:${item.id}`, provider: item.sourceDataset, sourceName: item.source,
    url: safeUrl(item.sourceUrl), title: title.slice(0, 500), text: null,
    kind: kind === "other" && structured ? "incident" : kind,
    nature: media ? "press" : thermal ? "sensor" : structured ? "structured" : "report",
    occurredAt: media ? null : date(item.eventDate), publishedAt: null, detectedAt: media ? date(item.eventDate) : null,
    receivedAt, position: validPosition(item.latitude, item.longitude, media ? "unknown" : item.geoPrecision ?? "unknown"),
    place: item.locality || null, countries: item.country ? [item.country] : [], entities: item.actors,
    upstreamAgency: agencyIn(`${item.source} ${title}`), confirmsOccurrence: false,
    severity: null, metric: null,
    caveat: media ? "Mention presse GDELT ; date de détection, lieu mentionné, événement non confirmé." : thermal ? "Détection thermique ; aucune attribution à un conflit." : structured ? "Incident codé par la source ; publication différée." : "Import opérateur ; provenance indépendante non établie.",
  };
}
