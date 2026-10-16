import type { ConflictEvent } from "@/types/conflict";
import { type Connector, safeFetch } from "./types";

/**
 * Connecteur GDELT 2.0 (source secondaire, temps réel).
 *
 * GDELT analyse en continu la presse internationale et publie, toutes les
 * quinze minutes, les lieux cités par les articles de conflit.
 *
 * Filtrage renforcé : seules les zones de tension et théâtres militaires
 * avérés sont retenus afin d'éliminer les faux positifs (faits divers
 * dans les pays en paix).
 */

const GEO_URL = "https://api.gdeltproject.org/api/v1/gkg_geojson";

/** Requête ciblée : terminologie militaire et affrontements armés. */
const QUERY = [
  '"armed clash"',
  '"armed clashes"',
  '"armed conflict"',
  "shelling",
  '"air strike"',
  "airstrike",
  '"military offensive"',
  '"drone strike"',
  '"missile strike"',
  '"heavy artillery"',
  '"combat operations"',
].join(" OR ");

/** Ton minimal conservé : couverture négative avérée. */
const TONE_MAX = -2.5;
const MAX_SIGNALS = 400;

const CONFLICT_ZONES = new Set([
  "ukraine", "russia", "israel", "palestine", "gaza", "west bank",
  "lebanon", "syria", "yemen", "sudan", "myanmar", "somalia",
  "mali", "burkina faso", "niger", "congo", "democratic republic of the congo",
  "drc", "iraq", "pakistan", "afghanistan", "nigeria", "ethiopia",
  "chad", "mozambique", "armenia", "azerbaijan", "taiwan", "iran",
  "libya", "central african republic", "colombia", "haiti", "south sudan",
  "red sea", "baltic", "black sea", "taiwan strait"
]);

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

let lastRequest = 0;

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "presse internationale";
  }
}

export const gdeltConnector: Connector = {
  id: "gdelt",
  label: "GDELT 2.0",

  isConfigured() {
    return process.env.GDELT_DISABLED !== "1";
  },

  describe() {
    return "Presse mondiale géolocalisée (GKG) — signaux en direct filtrés sur les zones de conflit.";
  },

  async fetchEvents() {
    const wait = 5200 - (Date.now() - lastRequest);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();

    const params = new URLSearchParams({ query: QUERY, MAXRECORDS: "1500" });
    const res = await safeFetch(
      "gdelt",
      `${GEO_URL}?${params.toString()}`,
      { headers: { Accept: "application/json" } },
      25_000,
    );
    const buffer = await res.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    let json: { features?: GkgFeature[] };
    try {
      json = JSON.parse(text) as { features?: GkgFeature[] };
    } catch {
      throw new Error("Réponse GDELT illisible (JSON invalide)");
    }

    const now = new Date().toISOString();
    const byPlace = new Map<string, { event: ConflictEvent; tone: number; count: number }>();

    for (const f of json.features ?? []) {
      const coords = f.geometry?.coordinates;
      if (!coords) continue;
      const [lon, lat] = coords;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const p = f.properties ?? {};
      const tone = Number(p.urltone ?? 0);
      if (tone > TONE_MAX) continue;

      const rawName = p.name ?? "";
      const parts = rawName.split(",").map((s) => s.trim()).filter(Boolean);
      if (!parts.length) continue;

      const country = parts.length > 1 ? parts[parts.length - 1] : parts[0];
      const locality = parts.length > 1 ? parts[0] : country;
      const countryLower = country.toLowerCase();

      // Filtrage des faux positifs : on retient les zones de conflit reconnues
      // ou les articles contenant des thèmes militaires stricts
      const themes = (p.mentionedthemes ?? "").toUpperCase();
      const isMilitaryTheme =
        themes.includes("WAR") ||
        themes.includes("MILITARY") ||
        themes.includes("ARMEDCONFLICT") ||
        themes.includes("AIRSTRIKE") ||
        themes.includes("TERROR");

      const isConflictZone =
        CONFLICT_ZONES.has(countryLower) ||
        [...CONFLICT_ZONES].some((z) => rawName.toLowerCase().includes(z));

      if (!isConflictZone && !isMilitaryTheme) {
        continue; // Élimine les faits divers dans les pays en paix
      }

      const cell = `${country}|${locality}|${lat.toFixed(1)}|${lon.toFixed(1)}`;
      const eventDate =
        p.urlpubtimedate && !Number.isNaN(Date.parse(p.urlpubtimedate))
          ? new Date(p.urlpubtimedate).toISOString()
          : now;

      const existing = byPlace.get(cell);
      if (existing) {
        existing.count++;
        if (tone < existing.tone) {
          existing.tone = tone;
          existing.event.source = `GDELT · ${existing.count} dépêche(s) · ${domainOf(p.url ?? "")}`;
          existing.event.sourceUrl = p.url ?? "";
          existing.event.eventDate = eventDate;
        }
        continue;
      }

      byPlace.set(cell, {
        tone,
        count: 1,
        event: {
          id: `gdelt-${lat.toFixed(2)}-${lon.toFixed(2)}-${locality.replace(/\W+/g, "-").toLowerCase()}`,
          latitude: lat,
          longitude: lon,
          country,
          region: parts.length > 2 ? parts[1] : "",
          locality,
          eventType: "Media signal",
          subEventType: "Alerte presse géolocalisée",
          actors: [],
          fatalities: 0,
          source: `GDELT · 1 dépêche · ${domainOf(p.url ?? "")}`,
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
