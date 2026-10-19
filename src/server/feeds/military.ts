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

const ADSB_CAVEAT =
  "Position ADS-B transmise volontairement : beaucoup d’aéronefs militaires n’émettent pas ; l’absence d’un appareil ne prouve rien. Le pays survolé est affiché ; la source ne fournit pas le pays de l’opérateur.";

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
  const items: LiveItem[] = [];
  for (const ac of aircraft) {
    const hex = str(ac.hex);
    const lat = num(ac.lat);
    const lon = num(ac.lon);
    const positionAge = num(ac.seen_pos) ?? num(ac.seen);
    if (!hex || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || positionAge === null || positionAge > 300 || positionAge < 0) continue;
    const occurredMs = nowMs - positionAge * 1000;
    if (!Number.isFinite(occurredMs)) continue;
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
      id: `adsb-lol-military:${hex.toLowerCase()}`,
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
    ttlMs: 2 * 60_000,
    async load(ctx) {
      return parseAdsbMilitary(await fetchJson("https://api.adsb.lol/v2/mil", { maxBytes: 2 * 1024 * 1024 }), ctx);
    },
  },
];
