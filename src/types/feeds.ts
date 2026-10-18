/**
 * Flux mondiaux en direct (hors conflits armés) : contrat partagé entre le
 * serveur (`src/server/feeds/*`, route `/api/feeds`) et l'interface.
 *
 * Règles de vérité :
 * - chaque élément porte sa source, son URL d'origine, sa date propre
 *   (`publishedAt`/`occurredAt`) distincte de la date de collecte (`fetchedAt`) ;
 * - `nature` dit ce qu'est la donnée : alerte officielle, mesure capteur,
 *   publication officielle, article de presse, signalement publié (témoignage)… ;
 * - aucun champ n'est inventé : inconnu = `null`.
 */

export const FEED_CATEGORIES = [
  "disaster", // catastrophes naturelles et climat (GDACS, USGS, EONET)
  "health", // épidémies (OMS)
  "space", // lancements spatiaux (Launch Library 2)
  "nuclear", // nucléaire civil et militaire (World Nuclear News…)
  "un", // ONU : actualités, Conseil de sécurité, déclarations
  "social", // manifestations, émeutes, grèves (GDELT 2.0 événements)
  "economy", // marchés, devises
  "uap", // phénomènes aériens non identifiés : rapports publiés
] as const;
export type FeedCategory = (typeof FEED_CATEGORIES)[number];

export type FeedNature =
  | "official_alert" // alerte émise par un organisme officiel (GDACS, OMS DON)
  | "sensor_measurement" // mesure instrumentale (séisme USGS, satellite)
  | "official_publication" // communiqué / article d'une institution (ONU, AARO, GEIPAN)
  | "press_article" // article de presse ou agrégat presse (GDELT, WNN) — non confirmé
  | "published_report" // signalement publié (témoignage) : n'établit pas un fait
  | "scheduled_event" // événement planifié (lancement spatial)
  | "market_quote"; // cotation de marché

export type FeedSeverity = "info" | "minor" | "moderate" | "severe" | "extreme";

export interface LiveItem {
  /** Identifiant stable : `${sourceId}:${idOrigine}`. */
  id: string;
  category: FeedCategory;
  nature: FeedNature;
  title: string;
  /** Résumé court en texte brut (sans HTML), ou null. */
  summary: string | null;
  /** URL de l'élément chez la source (jamais inventée). */
  url: string | null;
  sourceId: string; // ex. "gdacs", "usgs", "who-don"
  sourceName: string; // ex. "GDACS (ONU / Commission européenne)"
  /** Date de publication par la source (ISO 8601) ou null. */
  publishedAt: string | null;
  /** Date de l'événement lui-même (séisme, lancement…) ou null. */
  occurredAt: string | null;
  /** Date de collecte par ORBITAL (ISO 8601). */
  fetchedAt: string;
  /** ISO3 des pays concernés (peut être vide si non déterminable). */
  countries: string[];
  lat: number | null;
  lon: number | null;
  severity: FeedSeverity | null;
  /** Grandeur mesurée éventuelle (magnitude, variation %, etc.). */
  metric: { label: string; value: number; unit: string | null } | null;
  /** Avertissement à afficher avec l'élément (ex. « témoignage non vérifié »). */
  caveat: string | null;
}

export type FeedStatus = "ok" | "error" | "stale" | "not_configured";

export interface FeedSourceState {
  sourceId: string;
  sourceName: string;
  category: FeedCategory;
  status: FeedStatus;
  /** Message lisible en cas d'erreur (sans détail technique sensible). */
  message: string | null;
  fetchedAt: string | null;
  itemCount: number;
  homepage: string;
  license: string | null;
}

export interface FeedsResponse {
  generatedAt: string;
  items: LiveItem[];
  sources: FeedSourceState[];
}
