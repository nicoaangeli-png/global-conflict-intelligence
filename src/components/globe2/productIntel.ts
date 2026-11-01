import type { ConflictCluster } from "@/types/conflict";
import type { FeedsResponse, LiveItem } from "@/types/feeds";

export type ProductSignal = Readonly<{
  id: string;
  lat: number;
  lon: number;
  kind: "conflict" | "critical" | "event";
  label: string;
}>;

export const validPosition = (lat: number | null, lon: number | null): boolean =>
  lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon)
  && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

const conflictTypes = new Set(["Battles", "Explosions/Remote violence", "Violence against civilians"]);

/** Only real records; GDELT media mentions remain explicitly labelled as unconfirmed in the UI. */
export function selectConflictSignals(clusters: ConflictCluster[]): ConflictCluster[] {
  return clusters.filter(cluster => cluster.realShare === 1
    && conflictTypes.has(cluster.topType)
    && validPosition(cluster.latitude, cluster.longitude))
    .sort((a, b) => b.intensity - a.intensity || b.eventCount - a.eventCount);
}

export function dedupeFeeds(responses: FeedsResponse[]): LiveItem[] {
  return dedupeFeedItems(responses.flatMap(response => response.items));
}

export function dedupeFeedItems(input: LiveItem[]): LiveItem[] {
  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  const items = [...input]
    .sort((a, b) => Date.parse(b.occurredAt ?? b.publishedAt ?? "") - Date.parse(a.occurredAt ?? a.publishedAt ?? ""));
  return items.filter(item => {
    const contentKey = `${item.sourceId}|${item.title.trim().toLocaleLowerCase()}|${item.occurredAt ?? item.publishedAt ?? ""}`;
    if (seenIds.has(item.id) || seenContent.has(contentKey)) return false;
    seenIds.add(item.id); seenContent.add(contentKey);
    return true;
  });
}

export function signalForFeed(item: LiveItem): ProductSignal | null {
  if (item.lat === null || item.lon === null || !validPosition(item.lat, item.lon)) return null;
  const critical = item.nature === "official_alert" && (item.severity === "severe" || item.severity === "extreme");
  return { id: `feed:${item.id}`, lat: item.lat, lon: item.lon,
    kind: critical ? "critical" : "event", label: item.title };
}
