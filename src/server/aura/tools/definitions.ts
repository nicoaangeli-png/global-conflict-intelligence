import "server-only";
import { FEED_CATEGORIES } from "@/types/feeds";
import { RANGE_KEYS } from "../config";

/** Outils exposés au modèle (schémas Responses API) et libellés d'état affichés pendant leur exécution. */

export const AGENT_TOOLS = [
  { type: "web_search" },
  {
    type: "function",
    name: "get_orbital_events",
    description: "Événements du nouveau moteur ORBITAL, preuves, première source observée, facteurs du score heuristique, contradictions et chronologie des seuils 75/90. Recherche locale dans les 200 événements récents du snapshot, sans réseau. Pour des événements similaires, fournir lat/lon et éventuellement kind ; coordonnées inconnues exclues de la proximité. country correspond exactement au code ou nom conservé par le moteur.",
    parameters: {
      type: "object",
      properties: {
        eventId: { type: "string", minLength: 1, maxLength: 160 },
        query: { type: "string", minLength: 1, maxLength: 200 },
        country: { type: "string", minLength: 1, maxLength: 80 },
        lat: { type: "number", minimum: -90, maximum: 90 },
        lon: { type: "number", minimum: -180, maximum: 180 },
        radiusKm: { type: "number", exclusiveMinimum: 0, maximum: 500, description: "Avec lat et lon ; défaut 100 km" },
        kind: { type: "string", enum: ["explosion", "earthquake", "protest", "outage", "thermal", "incident", "weather", "other"] },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_platform_overview",
    description:
      "Situation mondiale vue par la console ORBITAL (données réelles sourcées uniquement, aucune démonstration) : zones actives, enregistrements 24h/7j/30j, couverture (documenté / presse / thermique), disponibilité et date la plus récente par source, pays les plus actifs. À utiliser pour toute question sur « ce que montre la carte ».",
    parameters: {
      type: "object",
      properties: { range: { type: "string", enum: RANGE_KEYS } },
      required: ["range"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_country_activity",
    description:
      "Derniers enregistrements de la base ORBITAL pour un pays (données réelles uniquement). Fournis le code iso3 du pays affiché quand il est connu ; le nom (anglais) sert de repli. Aucune correspondance approximative : un pays introuvable renvoie une erreur explicite.",
    parameters: {
      type: "object",
      properties: {
        country: { type: "string", description: "Nom du pays, vide si iso3 fourni" },
        iso3: { type: "string", description: "Code ISO alpha-3, vide si inconnu" },
        range: { type: "string", enum: RANGE_KEYS },
      },
      required: ["country", "iso3", "range"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_live_feeds",
    description:
      "Flux mondiaux ORBITAL récents, hors base de conflits : alertes, publications, presse, mesures, lancements, marchés et signalements publiés. À utiliser, avec get_country_activity si pertinent, AVANT web_search pour toute actualité mondiale ou nationale. Renvoie aussi l'état des sources, y compris les indisponibilités. Presse = non confirmée ; signalement UAP publié ≠ fait établi ; cotation Yahoo = indicative, non officielle et différée.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: FEED_CATEGORIES },
        country_iso3: { type: "string", pattern: "^[A-Z]{3}$", description: "Code ISO alpha-3, par exemple FRA ou UKR" },
        hours: { type: "integer", minimum: 1, maximum: 720, description: "Fenêtre glissante en heures, au plus 720" },
        limit: { type: "integer", minimum: 1, maximum: 40, description: "Nombre maximal d'éléments, au plus 40" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_country_leaders",
    description:
      "Chef de l'État et chef du gouvernement d'un pays d'après Wikidata (mandats sans date de fin ; peut être en retard ou incomplet). Code ISO alpha-3, ex. IRN, UKR, SDN.",
    parameters: {
      type: "object",
      properties: { iso3: { type: "string" } },
      required: ["iso3"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_country_indicators",
    description: "Population et PIB nominal (USD) annuels les plus récents d'un pays, d'après la Banque mondiale (code ISO alpha-3). Données annuelles, pas du temps réel.",
    parameters: {
      type: "object",
      properties: { iso3: { type: "string" } },
      required: ["iso3"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_airspace_activity",
    description:
      "Trafic aérien civil en direct au-dessus d'un pays (OpenSky, transpondeurs ADS-B) : avions en vol et au sol, pays d'immatriculation. Utile pour vérifier une fermeture d'espace aérien ou une reprise des vols. Les vols militaires y sont rarement visibles. Quota limité : n'appelle cet outil que si la question porte sur l'espace aérien.",
    parameters: {
      type: "object",
      properties: { iso3: { type: "string" } },
      required: ["iso3"],
      additionalProperties: false,
    },
  },
];

export const TOOL_STATUS: Record<string, string> = {
  get_orbital_events: "Lecture des preuves du moteur ORBITAL…",
  get_platform_overview: "Lecture de la situation mondiale ORBITAL…",
  get_country_activity: "Interrogation de la base d'événements…",
  get_live_feeds: "Lecture des flux mondiaux…",
  get_country_leaders: "Vérification des dirigeants (Wikidata)…",
  get_country_indicators: "Indicateurs Banque mondiale…",
  get_airspace_activity: "Trafic aérien en direct (OpenSky)…",
};

export const TOOL_LABEL: Record<string, string> = {
  get_orbital_events: "Détections et preuves ORBITAL",
  get_platform_overview: "Situation mondiale ORBITAL",
  get_country_activity: "Activité pays ORBITAL",
  get_live_feeds: "Flux mondiaux ORBITAL",
  get_country_leaders: "Dirigeants",
  get_country_indicators: "Indicateurs pays",
  get_airspace_activity: "Espace aérien",
};
