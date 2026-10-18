/**
 * Libellés d'interface partagés (FR / EN).
 *
 * Vocabulaire honnête (voir docs/audit-2026-10-18/01-SYNTHESE.md §3) :
 * un article de presse n'est jamais un « incident », une absence de donnée
 * n'est jamais « stable » ni « calme ».
 */
export type Locale = "fr" | "en";

/** Raccourci bilingue pour les libellés ponctuels. */
export const tr = (locale: Locale, fr: string, en: string) => (locale === "fr" ? fr : en);

export const DICT = {
  fr: {
    system: {
      title: "ORBITAL",
      tagline: "Contrôleur planétaire en temps réel",
      streamOpen: "Direct",
      streamConnecting: "Connexion…",
      streamClosed: "Direct interrompu",
      streamHint: "Connexion temps réel (SSE) au serveur ORBITAL : les nouvelles ingestions arrivent sans recharger la page.",
      briefing: "Bilan du jour",
      briefingSoon: "Bientôt : bilan vocal quotidien rédigé à partir des sources. Pas encore disponible.",
      sources: "Sources",
      settings: "Paramètres",
      close: "Fermer",
      retry: "Réessayer",
      loading: "Chargement…",
    },
  },
  en: {
    system: {
      title: "ORBITAL",
      tagline: "Real-time planetary monitor",
      streamOpen: "Live",
      streamConnecting: "Connecting…",
      streamClosed: "Live interrupted",
      streamHint: "Real-time connection (SSE) to the ORBITAL server: new ingestions arrive without reloading.",
      briefing: "Daily briefing",
      briefingSoon: "Coming soon: daily voice briefing written from the sources. Not available yet.",
      sources: "Sources",
      settings: "Settings",
      close: "Close",
      retry: "Retry",
      loading: "Loading…",
    },
  },
} as const;

export function t(locale: Locale) {
  return DICT[locale] ?? DICT.fr;
}
