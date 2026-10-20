/**
 * Logique pure des MOBILES MILITAIRES suivis (aéronefs ADS-B, navires AIS) :
 * nature du mobile, cap, trajet observé, champs lisibles du détail.
 * Testée dans tests/ui-trajets.test.ts.
 *
 * Règle : un trajet n'est fait que de positions réellement observées par la
 * source (`track`), jamais extrapolées ; sans `track`, aucun trajet n'est dessiné.
 */
import type { LiveItem } from "@/types/feeds";
import { itemHeading, itemTime } from "./feedModel";

/** `merchant` : navire civil observé dans un détroit stratégique (catégorie « shipping »). */
export type VehicleKind = "aircraft" | "vessel" | "merchant";

/** Nature des mobiles d'une source militaire, d'après son identifiant (AIS = navires, sinon ADS-B). */
export const sourceVehicleKind = (sourceId: string): VehicleKind => (/ais|vessel|ship|marine|maritime|navire/i.test(sourceId) ? "vessel" : "aircraft");

/** Nature du mobile : champ `vehicle` de la source ; à défaut, déduite de la source. */
export function vehicleOf(item: LiveItem): VehicleKind | null {
  if (item.category === "shipping") return item.vehicle === "vessel" ? "merchant" : null;
  if (item.category !== "military") return null;
  if (item.vehicle === "aircraft" || item.vehicle === "vessel") return item.vehicle;
  return sourceVehicleKind(item.sourceId);
}

export interface TrackPoint {
  lat: number;
  lon: number;
  /** Instant de l'observation (ms). */
  t: number;
}

const validPoint = (p: { lat: unknown; lon: unknown }) =>
  typeof p.lat === "number" && typeof p.lon === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/**
 * Trajet observé, du plus ancien au plus récent, terminé par la position courante
 * si elle est plus récente que le dernier point. Points invalides ou non datés ignorés.
 * Moins de deux points : pas de trajet (tableau vide).
 */
export function trackPoints(item: LiveItem): TrackPoint[] {
  const raw = Array.isArray(item.track) ? item.track : [];
  const points: TrackPoint[] = [];
  for (const p of raw) {
    if (!p || !validPoint(p)) continue;
    const t = Date.parse(p.at);
    if (Number.isNaN(t)) continue;
    points.push({ lat: p.lat, lon: p.lon, t });
  }
  points.sort((a, b) => a.t - b.t);
  const nowIso = itemTime(item);
  const now = nowIso ? Date.parse(nowIso) : NaN;
  if (item.lat !== null && item.lon !== null && validPoint(item) && !Number.isNaN(now)) {
    const last = points[points.length - 1];
    const same = last && Math.abs(last.lat - item.lat) < 1e-6 && Math.abs(last.lon - item.lon) < 1e-6;
    if (!same && (!last || now >= last.t)) points.push({ lat: item.lat, lon: item.lon, t: now });
  }
  return points.length >= 2 ? points : [];
}

/** Durée couverte par le trajet observé (ms), ou null sans trajet. */
export function trackDurationMs(item: LiveItem): number | null {
  const pts = trackPoints(item);
  return pts.length >= 2 ? pts[pts.length - 1].t - pts[0].t : null;
}

/** Relèvement initial (degrés, sens horaire depuis le nord) de a vers b. */
export function bearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = Math.PI / 180;
  const p1 = a.lat * toRad;
  const p2 = b.lat * toRad;
  const dl = (b.lon - a.lon) * toRad;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Orientation d'un mobile : cap publié par la source ; à défaut, direction des deux
 * dernières positions observées (calcul, pas invention) ; sinon null (symbole non orienté).
 */
export function vehicleHeading(item: LiveItem): { deg: number; from: "source" | "track" } | null {
  const published = itemHeading(item);
  if (published !== null) return { deg: published, from: "source" };
  const pts = trackPoints(item);
  if (pts.length < 2) return null;
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  if (Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6) return null;
  return { deg: bearing(a, b), from: "track" };
}

export interface VehicleFacts {
  /** Type d'appareil / de navire publié (ex. « C501 »). */
  type: string | null;
  /** Indicatif radio (aéronef) ou nom (navire). */
  callsign: string | null;
  registration: string | null;
  altitudeFt: number | null;
  speedKt: number | null;
}

const numberIn = (text: string | null, re: RegExp): number | null => {
  const m = text?.match(re);
  if (!m) return null;
  const v = Number(m[1].replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

/**
 * Champs lisibles d'un mobile, lus dans ce que publie la source (titre
 * « TYPE — INDICATIF — IMMATRICULATION » d'adsb.lol, résumé « Altitude … ; vitesse sol … »).
 * Un champ absent reste null : jamais deviné.
 */
export function vehicleFacts(item: LiveItem): VehicleFacts {
  const kind = vehicleOf(item);
  const parts = item.title.split(" — ").map((p) => p.trim());
  const altitudeFt = item.metric && /altitude/i.test(item.metric.label) && item.metric.unit === "ft" ? item.metric.value : numberIn(item.summary, /altitude\s+([\d\s  .,]+)\s*ft/i);
  const speedKt = item.metric && /vitesse/i.test(item.metric.label) && item.metric.unit === "kt" ? item.metric.value : numberIn(item.summary, /vitesse(?:\s+sol)?\s+([\d\s  .,]+)\s*(?:kt|nd|noeuds|nœuds)/i);
  if (kind === "aircraft" && parts.length >= 2) {
    return { type: parts[0] || null, callsign: parts[1] || null, registration: parts[2] || null, altitudeFt, speedKt };
  }
  return { type: null, callsign: null, registration: null, altitudeFt: kind === "vessel" ? null : altitudeFt, speedKt };
}

/** Durée lisible : « 42 min », « 3 h 05 ». */
export function formatDuration(ms: number, locale: "fr" | "en" = "fr"): string {
  const min = Math.max(0, Math.round(ms / 60e3));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return locale === "fr" ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h ${String(m).padStart(2, "0")} min`;
}
