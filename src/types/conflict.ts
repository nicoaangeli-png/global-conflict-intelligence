/**
 * Modèle interne commun à toutes les sources de données.
 *
 * Aucun connecteur ne parle directement au frontend : chaque source
 * (ACLED, GDELT, UCDP, import CSV, jeu de démonstration) est convertie
 * vers ces structures par la couche de normalisation serveur.
 */

/** Types d'événements (échelle de classification reprise d'ACLED). */
export const EVENT_TYPES = [
  "Battles",
  "Explosions/Remote violence",
  "Violence against civilians",
  "Riots",
  "Protests",
  "Strategic developments",
  /**
   * Anomalie thermique détectée par satellite (NASA FIRMS). Ce n'est ni un
   * combat ni une frappe : feu, torchère industrielle ou incendie. Ce type
   * n'indique donc jamais à lui seul un conflit.
   */
  "Thermal anomaly",
  /**
   * Signal presse géolocalisé (GDELT) : la nature exacte de l'événement n'est
   * pas établie par l'article. Ce type n'est JAMAIS présenté comme une donnée
   * confirmée — il porte toujours la confiance MEDIA_SIGNAL.
   */
  "Media signal",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Niveau de fiabilité de la donnée, toujours affiché à l'utilisateur. */
export const CONFIDENCE_LEVELS = ["CONFIRMED", "REPORTED", "MEDIA_SIGNAL", "DEMO"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** Jeux de données reconnus par la couche d'ingestion. */
export const SOURCE_DATASETS = ["acled", "gdelt", "ucdp", "firms", "import:csv", "demo:seed"] as const;
export type SourceDataset = (typeof SOURCE_DATASETS)[number] | (string & {});

/**
 * Jeux de données issus de sources réelles. Tout ce qui n'est pas là-dedans
 * (aujourd'hui `demo:seed`) est fabriqué pour la démonstration et doit rester
 * visuellement distinct.
 */
export const REAL_DATASETS = ["acled", "gdelt", "ucdp", "firms", "import:csv"] as const;

/** Événement normalisé, unité de base de l'application. */
export interface ConflictEvent {
  id: string;
  latitude: number;
  longitude: number;
  country: string;
  region: string;
  locality: string;
  eventType: EventType;
  subEventType: string;
  actors: string[];
  fatalities: number;
  source: string;
  sourceUrl: string;
  sourceDataset: SourceDataset;
  confidence: Confidence;
  /** Date de l'événement (ISO 8601). */
  eventDate: string;
  /** Dernière mise à jour de la donnée côté source (ISO 8601). */
  updatedAt: string;
}

/**
 * Agrégat géographique : un foyer de conflit.
 * Les marqueurs affichés sur le globe sont TOUJOURS des agrégats,
 * jamais des milliers d'événements individuels.
 */
export interface ConflictCluster {
  id: string;
  latitude: number;
  longitude: number;
  country: string;
  region: string;
  locality: string;
  eventCount: number;
  fatalities: number;
  /** Intensité normalisée 0..1 (densité, létalité et récence combinées). */
  intensity: number;
  /** Répartition par type d'événement. */
  typeCounts: Partial<Record<EventType, number>>;
  topType: EventType;
  /** Fiabilité la plus faible présente dans l'agrégat (règle de prudence). */
  confidence: Confidence;
  confidenceCounts: Partial<Record<Confidence, number>>;
  firstEventAt: string;
  lastEventAt: string;
  eventIds: string[];
  /**
   * Part (0..1) des événements issus de sources réelles. 0 = foyer entièrement
   * de démonstration, 1 = entièrement réel. Le rendu s'en sert pour teinter.
   */
  realShare: number;
}

/** Charge utile servie au client (colonne compacte, prête pour le GPU). */
export interface EventsResponse {
  generatedAt: string;
  dataset: string;
  range: TimeRangeKey;
  from: string;
  to: string;
  /** Nombre total d'événements couverts par la requête (avant agrégation). */
  totalEvents: number;
  totalFatalities: number;
  clusters: ConflictCluster[];
  /** Séries journalières pour les micro-graphes (sparklines). */
  daily: DailyBucket[];
}

export interface DailyBucket {
  /** Jour (ISO, 00:00Z). */
  day: string;
  events: number;
  fatalities: number;
}

export interface StatsResponse {
  coverage?: { documented: number; media: number; demo: number; thermal: number };
  generatedAt: string;
  range: TimeRangeKey;
  activeZones: number;
  majorZones: number;
  events24h: number;
  events7d: number;
  events30d: number;
  fatalitiesRange: number;
  lastDataUpdate: string;
  lastIngestAt: string;
  dataset: string;
  /** Nombre total d'événements indexés (toutes périodes). */
  totalInStore: number;
  /** Connecteurs et leur état. */
  connectors: ConnectorStatus[];
  daily: DailyBucket[];
  ingestReport?: string | null;
}

export interface ConnectorStatus {
  id: "acled" | "gdelt" | "ucdp" | "firms" | "import" | "demo";
  label: string;
  configured: boolean;
  reachable: boolean | null;
  note: string;
  events: number;
}

export type TimeRangeKey = "24h" | "7d" | "30d" | "6m" | "1y";

export const TIME_RANGES: { key: TimeRangeKey; label: string; days: number }[] = [
  { key: "24h", label: "24 H", days: 1 },
  { key: "7d", label: "7 J", days: 7 },
  { key: "30d", label: "30 J", days: 30 },
  { key: "6m", label: "6 MOIS", days: 182 },
  { key: "1y", label: "1 AN", days: 365 },
];

export interface EventFilters {
  range: TimeRangeKey;
  types: EventType[];
  datasets: SourceDataset[];
  confidences: Confidence[];
  countries: string[];
  minFatalities: number;
  /**
   * Curseur temporel (ISO 8601) : si renseigné, la fenêtre se termine à cette
   * date au lieu de « maintenant ». C'est le moteur de la timeline : on
   * reconstruit la situation telle qu'elle était à l'instant choisi.
   */
  at: string | null;
}
