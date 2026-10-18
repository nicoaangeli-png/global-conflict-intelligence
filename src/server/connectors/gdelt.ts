import type { ConflictEvent } from "@/types/conflict";
import { createHash } from "node:crypto";
import { ConnectorError, type Connector, safeFetch, providerDate, validCoordinates } from "./types";

/**
 * Connecteur GDELT 2.0 (source secondaire, temps réel).
 *
 * GDELT analyse en continu la presse internationale et publie, toutes les
 * quinze minutes, les lieux cités par les articles de conflit.
 *
 * Chaque enregistrement est une MENTION (article × lieu cité), pas un incident
 * vérifié : un lieu cité par un article n'est pas forcément le lieu des faits,
 * et `eventDate` est la date de PUBLICATION de l'article. Le filtrage (zones et
 * thèmes comparés par segments/mots entiers) réduit le bruit sans le supprimer.
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

/**
 * Zones retenues, comparées par SEGMENT ENTIER normalisé (jamais par
 * sous-chaîne : « Tirana » ne contient pas « Iran », « Malaysia » pas « Mali »,
 * « Somalia » pas « Mali »). Les alias couvrent les graphies fréquentes du
 * gazetteer ; ils ne modifient PAS le nom de pays conservé dans l'événement.
 */
const CONFLICT_ZONES = new Set([
  "ukraine", "russia", "israel", "palestine", "gaza", "gaza strip", "west bank",
  "lebanon", "syria", "yemen", "sudan", "myanmar", "somalia",
  "mali", "burkina faso", "niger", "congo", "democratic republic of the congo",
  "drc", "iraq", "pakistan", "afghanistan", "nigeria", "ethiopia",
  "chad", "mozambique", "armenia", "azerbaijan", "taiwan", "iran",
  "libya", "central african republic", "colombia", "haiti", "south sudan",
  "red sea", "baltic", "black sea", "taiwan strait",
]);

const ZONE_ALIASES: Record<string, string> = {
  burma: "myanmar",
  "russian federation": "russia",
  "state of palestine": "palestine",
  "palestinian territories": "palestine",
  "occupied palestinian territory": "palestine",
  "islamic republic of iran": "iran",
  "syrian arab republic": "syria",
  "dr congo": "drc",
  "democratic republic of congo": "democratic republic of the congo",
  "congo kinshasa": "democratic republic of the congo",
  "republic of south sudan": "south sudan",
  "republic of the sudan": "sudan",
};

/** Minuscules, sans diacritiques ni ponctuation, espaces compactés, article initial retiré. */
export function normalizePlace(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

/** Le nom de lieu GDELT (« Ville, Région, Pays ») contient-il un segment de zone connu ? */
export function isConflictZoneName(rawName: string): boolean {
  return rawName.split(",").some((segment) => {
    const key = normalizePlace(segment);
    return CONFLICT_ZONES.has(ZONE_ALIASES[key] ?? key);
  });
}

/**
 * Thèmes GKG : liste séparée par « ; ». Un thème compte s'il est exactement l'un
 * des codes militaires, ou s'il comporte un MOT entier de la liste (séparateur
 * « _ »). « AWARD » ou « SOFTWARE » ne contiennent donc pas « WAR ».
 */
const MILITARY_THEMES = new Set(["ARMEDCONFLICT", "MILITARY", "AIRSTRIKE", "TERROR", "WAR"]);

export function hasMilitaryTheme(themes: string): boolean {
  return themes
    .toUpperCase()
    .split(/[;,]/)
    .some((theme) => {
      const token = theme.trim();
      return MILITARY_THEMES.has(token) || token.split("_").some((word) => MILITARY_THEMES.has(word));
    });
}

/** Titre réel fourni par GDELT, ou null. Un titre n'est jamais construit ni déduit de l'URL. */
function providedTitle(p: Record<string, unknown>): string | null {
  for (const key of ["title", "urltitle", "sharetitle"]) {
    const v = p[key];
    if (typeof v !== "string") continue;
    const t = v.replace(/\s+/g, " ").trim();
    if (t.length >= 8 && !/^https?:\/\//i.test(t)) return t.slice(0, 240);
  }
  return null;
}

interface GkgFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    url?: string;
    urltone?: number;
    urlpubtimedate?: string;
    mentionedthemes?: string;
    [key: string]: unknown;
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
    const byPlace = new Map<string, { event: ConflictEvent; tone: number }>();

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

      // Zones et thèmes comparés par segment / mot entier (voir plus haut).
      if (!isConflictZoneName(rawName) && !hasMilitaryTheme(p.mentionedthemes ?? "")) continue;

      const eventDate = providerDate(p.urlpubtimedate);
      if (!eventDate || Date.parse(eventDate) > Date.parse(now) || Date.parse(eventDate) < Date.parse(now) - days * 86400e3) continue;
      let article: URL;
      try { article = new URL(p.url ?? ""); } catch { continue; }
      if (!["http:", "https:"].includes(article.protocol) || article.username || article.password) continue;
      article.hash = "";
      const cell = `${article.href}|${eventDate}|${lat}|${lon}`;

      const title = providedTitle(p);
      const domain = domainOf(article.href);
      const existing = byPlace.get(cell);
      if (existing) {
        // Même article, même lieu, même date : mention répétée, pas nouvelle source.
        if (tone < existing.tone) existing.tone = tone;
        continue;
      }

      byPlace.set(cell, {
        tone,
        event: {
          id: `gdelt-${createHash("sha256").update(cell).digest("hex").slice(0, 32)}`,
          latitude: lat,
          longitude: lon,
          country,
          region: parts.length > 2 ? parts[1] : "",
          locality,
          eventType: "Media signal",
          subEventType: "Mention presse géolocalisée",
          actors: [],
          fatalities: 0,
          // Titre uniquement s'il est fourni par GDELT ; sinon domaine seul.
          source: title ? `GDELT · ${domain} · « ${title} »` : `GDELT · ${domain} (titre non fourni)`,
          sourceUrl: article.href,
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
