import type { ConflictEvent } from "@/types/conflict";
import { type Connector, safeFetch } from "./types";

/**
 * Connecteur GDELT (source secondaire, temps réel).
 *
 * GDELT analyse en continu la presse internationale et publie, toutes les
 * quinze minutes, les lieux cités par les articles. Le point d'entrée utilisé
 * ici est l'API GKG GeoJSON (v1) : chaque entité porte un lieu, un article,
 * une date de publication et un ton éditorial.
 *
 * Règle éditoriale : un article ne CONFIRME pas un événement. Ces points sont
 * donc marqués `MEDIA_SIGNAL`, typés « Media signal », sans bilan humain
 * (jamais inventé) et n'écrasent jamais une donnée ACLED/UCDP.
 */

const GEO_URL = "https://api.gdeltproject.org/api/v1/gkg_geojson";

/** Requête : vocabulaire de conflit armé. */
const QUERY = [
  '"armed clash"',
  '"armed clashes"',
  '"armed conflict"',
  "shelling",
  '"air strike"',
  "airstrike",
  '"military offensive"',
  "gunmen",
  '"civilian casualties"',
  '"armed attack"',
].join(" OR ");

/** Ton minimal conservé : on écarte la couverture non conflictuelle. */
const TONE_MAX = -2.2;
/** Nombre maximal de foyers de signal conservés. */
const MAX_SIGNALS = 420;

interface GkgFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    url?: string;
    urltone?: number;
    urlpubtimedate?: string;
    mentionedthemes?: string;
  };
}

/** Une requête au maximum toutes les 5 s (limite demandée par GDELT). */
let lastRequest = 0;

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "presse";
  }
}

export const gdeltConnector: Connector = {
  id: "gdelt",
  label: "GDELT 2.0",

  isConfigured() {
    // API publique, sans identifiant. Désactivable par variable d'env.
    return process.env.GDELT_DISABLED !== "1";
  },

  describe() {
    return "Presse mondiale géolocalisée (GKG) — signaux non confirmés, rafraîchis toutes les 15 min.";
  },

  async fetchEvents() {
    const wait = 5200 - (Date.now() - lastRequest);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();

    const params = new URLSearchParams({ query: QUERY, MAXRECORDS: "2500" });
    const res = await safeFetch(
      "gdelt",
      `${GEO_URL}?${params.toString()}`,
      { headers: { Accept: "application/json" } },
      25_000,
    );
    // L'API renvoie parfois des octets non UTF-8 : on décode sans échouer.
    const buffer = await res.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    let json: { features?: GkgFeature[] };
    try {
      json = JSON.parse(text) as { features?: GkgFeature[] };
    } catch {
      throw new Error("Réponse GDELT illisible (JSON invalide)");
    }

    const now = new Date().toISOString();
    /** Regroupement par lieu : on garde le ton le plus négatif. */
    const byPlace = new Map<string, { event: ConflictEvent; tone: number; count: number }>();

    for (const f of json.features ?? []) {
      const coords = f.geometry?.coordinates;
      if (!coords) continue;
      const [lon, lat] = coords;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const p = f.properties ?? {};
      const tone = Number(p.urltone ?? 0);
      if (tone > TONE_MAX) continue;
      const name = (p.name ?? "").split(",")[0].trim();
      if (!name) continue;

      const cell = `${name}|${lat.toFixed(1)}|${lon.toFixed(1)}`;
      const eventDate = p.urlpubtimedate && !Number.isNaN(Date.parse(p.urlpubtimedate))
        ? new Date(p.urlpubtimedate).toISOString()
        : now;

      const existing = byPlace.get(cell);
      if (existing) {
        existing.count++;
        if (tone < existing.tone) {
          existing.tone = tone;
          existing.event.source = `GDELT · ${existing.count} article(s) · ${domainOf(p.url ?? "")}`;
          existing.event.sourceUrl = p.url ?? "";
          existing.event.eventDate = eventDate;
        }
        continue;
      }

      byPlace.set(cell, {
        tone,
        count: 1,
        event: {
          id: `gdelt-${lat.toFixed(2)}-${lon.toFixed(2)}-${name.replace(/\W+/g, "-").toLowerCase()}`,
          latitude: lat,
          longitude: lon,
          country: name,
          region: "",
          locality: name,
          eventType: "Media signal",
          subEventType: "Couverture presse",
          actors: [],
          // GDELT ne fournit aucun bilan fiable : jamais inventé.
          fatalities: 0,
          source: `GDELT · 1 article · ${domainOf(p.url ?? "")}`,
          sourceUrl: p.url ?? "",
          sourceDataset: "gdelt",
          confidence: "MEDIA_SIGNAL",
          eventDate,
          updatedAt: now,
        },
      });
    }

    return [...byPlace.values()]
      .sort((a, b) => a.tone - b.tone)
      .slice(0, MAX_SIGNALS)
      .map((v) => v.event);
  },
};
