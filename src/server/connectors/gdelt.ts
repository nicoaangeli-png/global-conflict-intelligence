import type { ConflictEvent } from "@/types/conflict";
import { createHash } from "node:crypto";
import { ConnectorError, type Connector, safeFetch, providerDate, validCoordinates } from "./types";

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

  async fetchEvents({ days }) {
    if (!this.isConfigured()) throw new ConnectorError("GDELT désactivé", "gdelt", "config");
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
      throw new ConnectorError("Réponse GDELT illisible", "gdelt", "parse");
    }
    if (!Array.isArray(json.features)) throw new ConnectorError("Réponse GDELT invalide", "gdelt", "parse");

    const now = new Date().toISOString();
    const byPlace = new Map<string, { event: ConflictEvent; tone: number; count: number }>();

    for (const f of json.features ?? []) {
      const coords = f.geometry?.coordinates;
      if (!coords) continue;
      const [lon, lat] = coords;
      if (!validCoordinates(lat, lon)) continue;
      const p = f.properties ?? {};
      const tone = Number(p.urltone ?? 0);
      if (!Number.isFinite(tone) || tone > TONE_MAX) continue;

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

      const eventDate = providerDate(p.urlpubtimedate);
      if (!eventDate || Date.parse(eventDate) > Date.parse(now) || Date.parse(eventDate) < Date.parse(now) - days * 86400e3) continue;
      let article: URL;
      try { article = new URL(p.url ?? ""); } catch { continue; }
      if (!["http:", "https:"].includes(article.protocol) || article.username || article.password) continue;
      article.hash = "";
      const cell = `${article.href}|${eventDate}|${lat}|${lon}`;

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
          id: `gdelt-${createHash("sha256").update(cell).digest("hex").slice(0, 32)}`,
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
