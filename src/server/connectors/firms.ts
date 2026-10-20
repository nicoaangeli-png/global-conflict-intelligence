import "server-only";
import { countryAt } from "@/lib/geo/world";
import { loadWorldIndex } from "../world";
import type { ConflictEvent } from "@/types/conflict";
import { ConnectorError, type Connector, providerDate, safeFetch, validCoordinates } from "./types";
import { parseCsv } from "./csvImport";

/**
 * Connecteur NASA FIRMS (VIIRS SNPP, activité d'incendie quasi temps réel).
 *
 * Fenêtre de deux jours : la donnée du jour courant arrive par tranches, et
 * les doublons sont éliminés par identifiant.
 *
 * Chaque détection est une anomalie thermique repérée par satellite. Ce n'est
 * ni un combat ni une frappe : feux de végétation, torchères et sites
 * industriels y figurent aussi. Le type « Anomalie thermique » ne sert donc
 * qu'à situer une chaleur anormale, jamais à conclure à un conflit. Une
 * détection n'observe aucune victime : `fatalities: 0` y signifie « non
 * applicable », pas « aucun mort » (voir `fatalitiesApplicable` côté intel).
 * La couche est indépendante de GDELT/UCDP ; seul l'affichage « près d'un
 * conflit » (intel.ts) la conditionne, et il est désactivable (`thermal=all`).
 *
 * Clé gratuite (MAP_KEY) envoyée par email : https://firms.modaps.eosdis.nasa.gov/api/map_key/
 * Pour limiter le volume, seules les détections « haute confiance » et de
 * puissance radiative (FRP) ≥ 15 MW sont gardées. Résultat mis en cache 3 h.
 */

const BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const SOURCE = "VIIRS_SNPP_NRT";
const MIN_FRP_MW = 15;
const CACHE_TTL_MS = 3 * 3600e3;

const firmsCache = globalThis as unknown as { __orbitalFirms?: { at: number; events: ConflictEvent[] } };

interface FirmsRow {
  latitude?: string;
  longitude?: string;
  acq_date?: string;
  acq_time?: string;
  satellite?: string;
  confidence?: string;
  frp?: string;
  daynight?: string;
}

export const firmsConnector: Connector = {
  id: "firms",
  label: "NASA FIRMS",

  isConfigured() {
    return process.env.FIRMS_DISABLED !== "1" && Boolean(process.env.FIRMS_MAP_KEY);
  },

  describe() {
    if (!process.env.FIRMS_MAP_KEY) return "NASA FIRMS — clé MAP_KEY requise (FIRMS_MAP_KEY).";
    const latest = firmsCache.__orbitalFirms?.events.reduce((max, e) => (e.eventDate > max ? e.eventDate : max), "");
    return `NASA FIRMS VIIRS SNPP — anomalies thermiques haute confiance (FRP ≥ ${MIN_FRP_MW} MW)${latest ? `, dernière détection ${latest.slice(0, 16)} UTC` : ""}.`;
  },

  async fetchEvents() {
    if (!this.isConfigured()) throw new ConnectorError("FIRMS non configuré", "firms", "config");
    const cached = firmsCache.__orbitalFirms;
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.events;

    const key = process.env.FIRMS_MAP_KEY ?? "";
    const res = await safeFetch("firms", `${BASE}/${encodeURIComponent(key)}/${SOURCE}/world/2`, { headers: { Accept: "text/csv" } }, 60000);
    const world = await loadWorldIndex().catch(() => null);
    const events: ConflictEvent[] = [];
    for (const row of parseCsv(await res.text()) as FirmsRow[]) {
      const frp = Number(row.frp);
      // FRP absent ou illisible : NaN < seuil est faux, la ligne passait le filtre.
      if (row.confidence !== "h" || !row.frp?.trim() || !Number.isFinite(frp) || frp < MIN_FRP_MW) continue;
      if (!validCoordinates(row.latitude, row.longitude)) continue;
      const time = (row.acq_time ?? "0000").padStart(4, "0");
      const date = providerDate(`${row.acq_date} ${time.slice(0, 2)}:${time.slice(2, 4)}:00`);
      if (!date) continue;
      const lat = Number(row.latitude);
      const lon = Number(row.longitude);
      const country = world ? countryAt(world, lat, lon) : null;
      events.push({
        id: `firms-${row.satellite ?? "viirs"}-${lat}-${lon}-${row.acq_date}-${time}`,
        latitude: lat,
        longitude: lon,
        country: country?.name ?? "",
        region: country?.continent ?? "",
        locality: `Détection thermique · FRP ${frp.toFixed(1)} MW`,
        eventType: "Thermal anomaly",
        subEventType: row.daynight === "D" ? "Diurne" : "Nocturne",
        actors: [],
        fatalities: 0,
        source: "NASA FIRMS · VIIRS SNPP · détection thermique satellitaire (cause non établie)",
        sourceUrl: "https://firms.modaps.eosdis.nasa.gov/map/",
        sourceDataset: "firms",
        confidence: "REPORTED",
        eventDate: date,
        updatedAt: new Date().toISOString(),
      });
    }
    firmsCache.__orbitalFirms = { at: Date.now(), events };
    return events;
  },
};
