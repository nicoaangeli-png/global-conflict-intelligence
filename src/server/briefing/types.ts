/**
 * Bilan du jour : contrat partagé entre le serveur (`src/server/briefing`),
 * la route `/api/briefing` et l'interface (lecteur vocal).
 */

export const CHAPTER_KEYS = ["conflicts", "politics", "disasters", "economy", "space", "nuclear", "society", "health"] as const;
export type ChapterKey = (typeof CHAPTER_KEYS)[number];

export const CHAPTER_TITLES: Record<ChapterKey, string> = {
  conflicts: "Conflits",
  politics: "Décisions politiques",
  disasters: "Catastrophes et climat",
  economy: "Économie et marchés",
  space: "Espace",
  nuclear: "Nucléaire",
  society: "Société",
  health: "Santé",
};

/** Texte d'un chapitre sans fait, honnête sur la fenêtre réellement examinée. */
export const emptyChapterText = (windowHours: number) => `Rien de significatif dans nos sources sur ${windowHours} h.`;
export const EMPTY_CHAPTER_TEXT = emptyChapterText(24);

export interface FactSource {
  name: string;
  url: string | null;
  /** Date de publication ou de l'événement (ISO 8601) ou null. */
  date: string | null;
  /** Titre de l'article chez cette source (presse), sinon null. */
  title?: string | null;
  /** Organisme officiel (GDACS, USGS, OMS, ONU, UCDP, NASA, BCE…). */
  official: boolean;
}

export type FactSeverity = "info" | "minor" | "moderate" | "severe" | "extreme";

export interface BriefingFact {
  id: string;
  chapter: ChapterKey;
  title: string;
  summary: string | null;
  severity: FactSeverity | null;
  /** Nature de la donnée (cf. FeedNature) ou "conflict_record". */
  nature: string;
  occurredAt: string | null;
  countries: string[];
  lat: number | null;
  lon: number | null;
  metric: { label: string; value: number; unit: string | null } | null;
  /** Bilan humain chiffré : uniquement pour une source structurée officielle (UCDP). */
  fatalities: number | null;
  /** Faux pour tout fait issu de la presse : aucun chiffre de victimes ne doit être prononcé. */
  casualtiesAllowed: boolean;
  sources: FactSource[];
  /** Nombre de domaines indépendants qui rapportent le fait (au-delà des 4 sources listées). */
  independentSources: number;
  /** Titres (2-3) d'une histoire de presse : seule matière que la rédaction peut utiliser. */
  headlines: string[];
  /** Date de l'événement en français (« vendredi 16 octobre »), fuseau UTC, ou null. */
  dateLabel: string | null;
  /** Source non officielle à nommer dans la phrase (« Yahoo Finance »), sinon null. */
  unofficialSource: string | null;
}

export interface BriefingSentence {
  text: string;
  factIds: string[];
}

export interface BriefingChapter {
  key: ChapterKey;
  title: string;
  spokenText: string;
  sentences: BriefingSentence[];
  facts: BriefingFact[];
  /** Fenêtre réellement examinée (24 h, élargie à 72 h ou 7 j si le chapitre était vide). */
  windowHours: number;
  /** Lieu du fait principal, pour déplacer le globe pendant la lecture. */
  focus: { lat: number; lon: number } | null;
  /** "ai" : rédigé par le modèle ; "template" : gabarit factuel ; "empty" : aucun fait. */
  writer: "ai" | "template" | "empty";
}

export interface Briefing {
  /** Jour UTC (AAAA-MM-JJ). */
  date: string;
  generatedAt: string;
  status: "ok" | "degraded";
  reason: string | null;
  chapters: BriefingChapter[];
}
