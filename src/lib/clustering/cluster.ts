import { CONFLICT } from "@/lib/config/visual";
import { cellKey, greatCircleKm } from "@/lib/geo/latlon";
import {
  type Confidence,
  type ConflictCluster,
  type ConflictEvent,
  type EventType,
  type GeoPrecision,
  EVENT_TYPES,
} from "@/types/conflict";

/**
 * Agrégation géographique et modèle d'intensité.
 *
 * Objectif : ne jamais afficher 3 000 marqueurs illisibles. Les événements
 * sont regroupés dans une grille géodésique (cellules corrigées en longitude
 * par le cosinus de la latitude), puis chaque foyer reçoit une intensité
 * combinant densité, létalité et récence — l'intensité pilote la luminosité,
 * la couleur, le halo et la pulsation, jamais seulement la taille.
 */

const CONFIDENCE_RANK: Record<Confidence, number> = {
  DEMO: 0,
  MEDIA_SIGNAL: 1,
  REPORTED: 2,
  CONFIRMED: 3,
};

/** Intensité 0..1 d'un foyer. */
export function computeIntensity(input: {
  eventCount: number;
  fatalities: number;
  lastEventAt: string;
  now?: number;
}): number {
  const w = CONFLICT.intensity;
  const now = input.now ?? Date.now();

  const density = Math.min(1, Math.log1p(input.eventCount) / Math.log1p(w.eventCountCeil));
  const lethality = Math.min(1, Math.log1p(input.fatalities) / Math.log1p(w.fatalitiesCeil));
  const ageDays = Math.max(0, (now - Date.parse(input.lastEventAt)) / 86400000);
  const recency = Math.pow(0.5, ageDays / w.recencyHalfLifeDays);

  const raw = density * w.weightEventCount + lethality * w.weightFatalities + recency * w.weightRecency;
  // courbe douce : les foyers majeurs se détachent nettement
  return Math.min(1, Math.pow(raw, 1.35));
}

/** Rayon de regroupement (degrés) adapté à la distance caméra. */
export function clusterDegreesForCamera(distance: number): number {
  const levels = CONFLICT.cluster.levels;
  for (const l of levels) if (distance <= l.distance) return l.degrees;
  return levels[levels.length - 1].degrees;
}

export interface ClusterOptions {
  degrees: number;
  now?: number;
  /** Nombre minimal d'événements pour former un foyer. */
  minEvents?: number;
}

/** Agrège une liste d'événements en foyers. */
export function aggregateClusters(events: ConflictEvent[], options: ClusterOptions): ConflictCluster[] {
  const now = options.now ?? Date.now();
  const minEvents = options.minEvents ?? CONFLICT.cluster.minEvents;
  const buckets = new Map<string, ConflictEvent[]>();

  for (const e of events) {
    const category = e.confidence === "DEMO" || e.sourceDataset.startsWith("demo")
      ? "demo"
      : e.confidence === "MEDIA_SIGNAL" || e.sourceDataset === "gdelt" ? "media" : "documented";
    const key = `${cellKey(e.latitude, e.longitude, options.degrees)}|${encodeURIComponent(e.country)}|${category}`;
    const list = buckets.get(key);
    if (list) list.push(e);
    else buckets.set(key, [e]);
  }

  const clusters: ConflictCluster[] = [];

  for (const [key, list] of buckets) {
    if (list.length < minEvents) continue;

    let latSum = 0;
    let lonSum = 0;
    let fatalities = 0;
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    let topType: EventType = "Battles";
    let topCount = -1;
    let weakest: Confidence = "CONFIRMED";
    const typeCounts: Partial<Record<EventType, number>> = {};
    const confidenceCounts: Partial<Record<Confidence, number>> = {};
    const eventIds: string[] = [];
    /** Événements réellement sourcés (tout sauf le jeu de démonstration). */
    let realCount = 0;

    // centroïde pondéré par la létalité : un foyer se place là où se
    // concentre l'essentiel de l'activité, pas au barycentre géométrique
    let wSum = 0;

    for (const e of list) {
      const w = 1 + Math.log1p(e.fatalities) * 2;
      latSum += e.latitude * w;
      lonSum += e.longitude * w;
      wSum += w;
      fatalities += e.fatalities;
      const t = Date.parse(e.eventDate);
      if (t < first) first = t;
      if (t > last) last = t;
      typeCounts[e.eventType] = (typeCounts[e.eventType] ?? 0) + 1;
      confidenceCounts[e.confidence] = (confidenceCounts[e.confidence] ?? 0) + 1;
      if (CONFIDENCE_RANK[e.confidence] < CONFIDENCE_RANK[weakest]) weakest = e.confidence;
      if (!e.sourceDataset.startsWith("demo")) realCount++;
      eventIds.push(e.id);
    }

    for (const t of EVENT_TYPES) {
      const c = typeCounts[t] ?? 0;
      if (c > topCount) {
        topCount = c;
        topType = t;
      }
    }

    const latitude = latSum / wSum;
    const longitude = lonSum / wSum;
    const lastEventAt = new Date(last).toISOString();

    let hasCity = false;
    let hasRegion = false;
    let hasCountry = false;
    for (const e of list) {
      const p = e.geoPrecision ?? "city";
      if (p === "city") hasCity = true;
      else if (p === "region") hasRegion = true;
      else if (p === "country") hasCountry = true;
    }
    const geoPrecision: GeoPrecision = hasCity ? "city" : hasRegion ? "region" : "country";

    // Le pays affiché est celui de l'événement le plus grave (proxy de foyer).
    const anchor = list.reduce((a, b) => (b.fatalities > a.fatalities ? b : a), list[0]);

    clusters.push({
      id: `z-${key}`,
      latitude,
      longitude,
      country: anchor.country,
      region: anchor.region,
      locality: anchor.locality,
      eventCount: list.length,
      fatalities,
      intensity: computeIntensity({ eventCount: list.length, fatalities, lastEventAt, now: now as number }),
      typeCounts,
      topType,
      confidence: weakest,
      confidenceCounts,
      firstEventAt: new Date(first).toISOString(),
      lastEventAt,
      eventIds,
      realShare: list.length ? realCount / list.length : 0,
      geoPrecision,
    });
  }

  clusters.sort((a, b) => b.intensity - a.intensity);
  return clusters;
}

/** Distance (km) du foyer le plus proche — utile pour la déduplication. */
export function nearestClusterKm(clusters: ConflictCluster[], lat: number, lon: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const c of clusters) {
    const d = greatCircleKm(lat, lon, c.latitude, c.longitude);
    if (d < best) best = d;
  }
  return best;
}

/** Empreinte de déduplication : même source + même jour + ~10 km. */
export function dedupeKey(e: ConflictEvent): string {
  const day = e.eventDate.slice(0, 10);
  return `${e.sourceDataset}|${day}|${e.eventType}|${e.latitude.toFixed(2)}|${e.longitude.toFixed(2)}`;
}

export function dedupe(events: ConflictEvent[]): { kept: ConflictEvent[]; removed: number } {
  const seen = new Set<string>();
  const kept: ConflictEvent[] = [];
  let removed = 0;
  for (const e of events) {
    const key = e.id ? `${e.sourceDataset}|${e.id}` : dedupeKey(e);
    if (seen.has(key)) {
      removed++;
      continue;
    }
    seen.add(key);
    kept.push(e);
  }
  return { kept, removed };
}
