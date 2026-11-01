import type { ConflictCluster } from "@/types/conflict";
import type { FeedsResponse, LiveItem } from "@/types/feeds";
import { THEME_COLORS, type ThemeKey } from "@/components/feeds/feedModel";

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
export const isViolentCluster = (cluster: ConflictCluster): boolean => conflictTypes.has(cluster.topType);

/** Only real records; GDELT media mentions remain explicitly labelled as unconfirmed in the UI. */
export function selectConflictSignals(clusters: ConflictCluster[]): ConflictCluster[] {
  return clusters.filter(cluster => cluster.realShare === 1
    && isViolentCluster(cluster)
    && validPosition(cluster.latitude, cluster.longitude))
    .sort((a, b) => b.intensity - a.intensity || b.eventCount - a.eventCount);
}

/** Existing non-violent event types stay available without taking the red conflict language. */
export function selectOtherEventSignals(clusters: ConflictCluster[]): ConflictCluster[] {
  return clusters.filter(cluster => cluster.realShare === 1 && !isViolentCluster(cluster)
    && validPosition(cluster.latitude, cluster.longitude));
}

export function otherEventColor(cluster: ConflictCluster): string {
  if (cluster.topType === "Thermal anomaly") return THEME_COLORS.disaster;
  if (cluster.topType === "Strategic developments") return THEME_COLORS.infrastructure;
  return THEME_COLORS.social;
}

export function clusterVisibleForTheme(cluster: ConflictCluster, theme: ThemeKey): boolean {
  if (isViolentCluster(cluster)) return theme === "all" || theme === "conflict";
  if (theme === "all") return true;
  if (theme === "social") return ["Protests", "Riots", "Media signal"].includes(cluster.topType);
  if (theme === "disaster") return cluster.topType === "Thermal anomaly";
  if (theme === "infrastructure") return cluster.topType === "Strategic developments";
  return false;
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
