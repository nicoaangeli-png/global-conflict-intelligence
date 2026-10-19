/**
 * Calques de référence du globe (infrastructures stables, hors flux en direct) :
 * contrat partagé entre `src/server/layers/*`, la route `/api/layers` et l'interface.
 *
 * Règles de vérité :
 * - un calque de référence décrit ce qui EXISTE (installation, câble, liste
 *   officielle), jamais un événement ; il porte la date de sa source (`asOf`) ;
 * - chaque élément porte son identifiant chez la source et son lien ;
 * - aucun attribut inventé : inconnu = `null`.
 */

export const LAYER_IDS = [
  "nuclear_plants", // centrales nucléaires (Wikidata, CC0)
  "military_bases", // bases militaires en service (Wikidata, CC0)
  "submarine_cables", // câbles sous-marins (TeleGeography Submarine Cable Map)
  "sanctions", // entités sanctionnées par pays (OFAC, Trésor des États-Unis)
] as const;
export type LayerId = (typeof LAYER_IDS)[number];

export type LayerGeometry =
  | { type: "Point"; coordinates: [number, number] } // [lon, lat]
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "MultiLineString"; coordinates: [number, number][][] };

export interface LayerFeature {
  /** Identifiant stable : `${layerId}:${idChezLaSource}`. */
  id: string;
  name: string;
  /** Pays (ISO3) ; vide si non déterminable. */
  countries: string[];
  /** Null pour un calque agrégé par pays sans géométrie propre (ex. sanctions). */
  geometry: LayerGeometry | null;
  /** Attributs propres à la source, valeurs brutes vérifiables (statut, opérateur, capacité…). */
  properties: Record<string, string | number | boolean | null>;
  /** Lien vers la fiche de l'élément chez la source. */
  url: string | null;
}

export interface LayerResponse {
  layerId: LayerId;
  title: string;
  sourceName: string;
  homepage: string;
  license: string | null;
  /** Date de la donnée chez la source (mise à jour de la liste, du jeu…), ou null. */
  asOf: string | null;
  /** Date de collecte par ORBITAL. */
  fetchedAt: string;
  status: "ok" | "error" | "stale";
  message: string | null;
  /** Avertissement à afficher avec le calque (couverture partielle, licence…). */
  caveat: string | null;
  features: LayerFeature[];
}
