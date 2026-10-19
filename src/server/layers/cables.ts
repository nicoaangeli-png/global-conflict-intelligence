import type { LayerFeature, LayerGeometry } from "@/types/layers";
import { FeedError, fetchJson } from "@/server/feeds/util";
import { feature, isRecord, text } from "./common";

const CABLE_GEO_URL = "https://www.submarinecablemap.com/api/v3/cable/cable-geo.json";
const CABLE_LIST_URL = "https://www.submarinecablemap.com/api/v3/cable/all.json";

type CableListItem = { id: string; name: string };

function lineGeometry(value: unknown): LayerGeometry | null {
  if (!isRecord(value) || (value.type !== "LineString" && value.type !== "MultiLineString") || !Array.isArray(value.coordinates)) return null;
  const validPoint = (point: unknown): point is [number, number] => Array.isArray(point) && point.length >= 2 && typeof point[0] === "number" && typeof point[1] === "number" && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
  if (value.type === "LineString") {
    const points = value.coordinates.filter(validPoint);
    return points.length >= 2 ? { type: "LineString", coordinates: points } : null;
  }
  const lines = value.coordinates.map((line) => Array.isArray(line) ? line.filter(validPoint) : []).filter((line) => line.length >= 2);
  return lines.length ? { type: "MultiLineString", coordinates: lines } : null;
}

/** Le GeoJSON ne publie pas systématiquement les pays d'atterrissement : aucun pays n'est déduit des tracés. */
export function parseSubmarineCables(raw: unknown, names: CableListItem[] = []): LayerFeature[] {
  if (!isRecord(raw) || !Array.isArray(raw.features)) throw new FeedError("TeleGeography a renvoyé un GeoJSON de câbles invalide.");
  const labels = new Map(names.map((c) => [c.id, c.name]));
  const seen = new Set<string>();
  const features: LayerFeature[] = [];
  for (const item of raw.features) {
    if (!isRecord(item) || !isRecord(item.properties)) continue;
    const id = text(item.properties.id);
    const geometry = lineGeometry(item.geometry);
    if (!id || !geometry || seen.has(id)) continue;
    seen.add(id);
    const name = text(item.properties.name) ?? labels.get(id) ?? id;
    features.push(feature(`submarine_cables:${id}`, name, [], geometry, {
      color: text(item.properties.color),
      landingPoint: Array.isArray(item.properties.coordinates) ? JSON.stringify(item.properties.coordinates) : null,
    }, `https://www.submarinecablemap.com/cable/${id}`));
  }
  return features;
}

function parseCableList(raw: unknown): CableListItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => isRecord(value) && text(value.id) && text(value.name) ? [{ id: text(value.id)!, name: text(value.name)! }] : []);
}

export async function loadSubmarineCables(): Promise<LayerFeature[]> {
  const geo = await fetchJson<unknown>(CABLE_GEO_URL, { maxBytes: 3 * 1024 * 1024 });
  // La liste ne sert qu'à compléter un nom absent du GeoJSON : son absence ne doit pas masquer les tracés.
  const names = await fetchJson<unknown>(CABLE_LIST_URL, { maxBytes: 512 * 1024 }).then(parseCableList).catch(() => []);
  return parseSubmarineCables(geo, names);
}

export const SUBMARINE_CABLE_LICENSE = "Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)";
