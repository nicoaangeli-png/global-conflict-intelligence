import type { LiveItem } from "@/types/feeds";
import { countryFromCoords, fetchJson, FeedError, num, plainText, str, type FeedContext, type FeedSourceDef } from "./util";

interface AdsbAircraft {
  hex?: string;
  flight?: string;
  r?: string;
  t?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  alt_geom?: number;
  gs?: number;
  track?: number;
  seen?: number;
  seen_pos?: number;
}

interface AdsbResponse {
  now?: number;
  ac?: AdsbAircraft[];
}

export interface AircraftTrackRecord {
  lastSeenAt: number;
  points: NonNullable<LiveItem["track"]>;
}

type AircraftTrackStore = Map<string, AircraftTrackRecord>;

export const ADSB_TRACK_WINDOW_MS = 3 * 60 * 60_000;
export const ADSB_MAX_TRACK_POINTS = 60;
/** Borne défensive, supérieure au volume observé de `/v2/mil`, partagée entre bundles serveur. */
export const ADSB_MAX_TRACKED_AIRCRAFT = 2_000;
const ADSB_TRACKS_GLOBAL_KEY = "__orbitalAdsbTracksV1";

const ADSB_CAVEAT =
  "Position ADS-B transmise volontairement : beaucoup d’aéronefs militaires n’émettent pas ; l’absence d’un appareil ne prouve rien. Le pays survolé est affiché ; la source ne fournit pas le pays de l’opérateur.";

function aircraftTracks(): AircraftTrackStore {
  const global = globalThis as unknown as Record<string, AircraftTrackStore | undefined>;
  return (global[ADSB_TRACKS_GLOBAL_KEY] ??= new Map());
}

/** Réservé aux tests : la mémoire applicative est normalement conservée entre les requêtes. */
export function clearAdsbTracks(): void {
  aircraftTracks().clear();
}

/** Instantané sérialisable des trajets (sauvegarde entre redémarrages). */
export function exportAdsbTracks(): [string, AircraftTrackRecord][] {
  return [...aircraftTracks().entries()];
}

/** Restaure des trajets sauvegardés sans écraser ceux déjà observés depuis le démarrage. */
export function importAdsbTracks(entries: [string, AircraftTrackRecord][], nowMs = Date.now()): void {
  const tracks = aircraftTracks();
  for (const [hex, record] of entries) {
    if (!tracks.has(hex) && Array.isArray(record?.points) && Number.isFinite(record.lastSeenAt)) tracks.set(hex, record);
  }
  purgeAircraftTracks(nowMs);
}

export function adsbTrackStats(): { aircraft: number; points: number } {
  const records = [...aircraftTracks().values()];
  return { aircraft: records.length, points: records.reduce((total, record) => total + record.points.length, 0) };
}

function compactTrack(points: NonNullable<LiveItem["track"]>): NonNullable<LiveItem["track"]> {
  let compacted = points;
  while (compacted.length > ADSB_MAX_TRACK_POINTS) {
    const last = compacted.at(-1)!;
    compacted = compacted.filter((_point, index) => index % 2 === 0);
    if (compacted.at(-1) !== last) compacted.push(last);
  }
  return compacted;
}

function purgeAircraftTracks(nowMs: number): void {
  const tracks = aircraftTracks();
  const cutoff = nowMs - ADSB_TRACK_WINDOW_MS;
  for (const [hex, record] of tracks) {
    record.points = record.points.filter((point) => Date.parse(point.at) >= cutoff);
    if (record.lastSeenAt < cutoff || record.points.length === 0) tracks.delete(hex);
  }
  if (tracks.size <= ADSB_MAX_TRACKED_AIRCRAFT) return;
  const oldest = [...tracks.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
  for (let i = 0; i < oldest.length - ADSB_MAX_TRACKED_AIRCRAFT; i++) tracks.delete(oldest[i][0]);
}

function observeAircraft(hex: string, lat: number, lon: number, occurredMs: number, nowMs: number): NonNullable<LiveItem["track"]> {
  const tracks = aircraftTracks();
  const record = tracks.get(hex) ?? { lastSeenAt: nowMs, points: [] };
  const point = { lat, lon, at: new Date(occurredMs).toISOString() };
  const previous = record.points.at(-1);
  if (!previous || previous.lat !== lat || previous.lon !== lon) record.points.push(point);
  record.lastSeenAt = nowMs;
  record.points = compactTrack(record.points.filter((candidate) => Date.parse(candidate.at) >= nowMs - ADSB_TRACK_WINDOW_MS));
  tracks.set(hex, record);
  purgeAircraftTracks(nowMs);
  return [...(tracks.get(hex)?.points ?? [point])];
}

function aircraftTitle(ac: AdsbAircraft): string {
  const type = plainText(ac.t) || "Aéronef militaire";
  const details = [plainText(ac.flight), plainText(ac.r)].filter(Boolean);
  return details.length ? `${type} — ${details.join(" — ")}` : type;
}

/** Convertit la photographie ADS-B : seules les positions vieilles d'au plus cinq minutes sont conservées. */
export function parseAdsbMilitary(raw: unknown, ctx: FeedContext): LiveItem[] {
  const response = raw as AdsbResponse | null;
  const aircraft = response?.ac;
  const now = num(response?.now);
  if (!Array.isArray(aircraft) || now === null) throw new FeedError("adsb.lol : format de réponse inattendu.");
  // L'API expose actuellement `now` en millisecondes ; accepte aussi des secondes Unix sans inventer la date.
  const nowMs = now > 10_000_000_000 ? now : now * 1000;
  purgeAircraftTracks(nowMs);
  const items: LiveItem[] = [];
  for (const ac of aircraft) {
    const hex = str(ac.hex);
    const lat = num(ac.lat);
    const lon = num(ac.lon);
    const positionAge = num(ac.seen_pos) ?? num(ac.seen);
    if (!hex || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || positionAge === null || positionAge > 300 || positionAge < 0) continue;
    const occurredMs = nowMs - positionAge * 1000;
    if (!Number.isFinite(occurredMs)) continue;
    const normalizedHex = hex.toLowerCase();
    const altitude = num(ac.alt_baro) ?? num(ac.alt_geom);
    const speed = num(ac.gs);
    const track = num(ac.track);
    const summary = [
      altitude !== null ? `Altitude ${Math.round(altitude).toLocaleString("fr-FR")} ft` : null,
      speed !== null ? `vitesse sol ${Math.round(speed)} kt` : null,
      track !== null ? `cap ${Math.round(track)}°` : null,
    ]
      .filter(Boolean)
      .join(" ; ");
    items.push({
      id: `adsb-lol-military:${normalizedHex}`,
      category: "military",
      nature: "sensor_measurement",
      title: aircraftTitle(ac),
      summary: summary || null,
      url: "https://adsb.lol/",
      sourceId: "adsb-lol-military",
      sourceName: "adsb.lol",
      publishedAt: null,
      occurredAt: new Date(occurredMs).toISOString(),
      fetchedAt: ctx.fetchedAt,
      countries: countryFromCoords(ctx.index, lat, lon),
      lat,
      lon,
      severity: null,
      metric: altitude !== null ? { label: "Altitude", value: altitude, unit: "ft" } : speed !== null ? { label: "Vitesse sol", value: speed, unit: "kt" } : null,
      caveat: ADSB_CAVEAT,
      vehicle: "aircraft",
      track: observeAircraft(normalizedHex, lat, lon, occurredMs, nowMs),
    });
  }
  return items;
}

export const militarySources: FeedSourceDef[] = [
  {
    sourceId: "adsb-lol-military",
    sourceName: "adsb.lol",
    category: "military",
    homepage: "https://adsb.lol/",
    license: "Open Database License (ODbL) 1.0 — attribution « adsb.lol »",
    // Une collecte au plus toutes les 15 s quand `/api/feeds` est effectivement sollicitée.
    ttlMs: 15_000,
    async load(ctx) {
      return parseAdsbMilitary(await fetchJson("https://api.adsb.lol/v2/mil", { maxBytes: 2 * 1024 * 1024 }), ctx);
    },
  },
];
