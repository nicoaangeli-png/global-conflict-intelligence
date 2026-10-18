import { fetchSocialFeed } from "@/server/connectors/gdeltEvents";
import type { FeedSourceDef } from "./util";

/**
 * Manifestations, émeutes et grèves des dernières 24 h (GDELT 2.0 événements,
 * catégorie CAMEO 14). Signal presse : jamais confirmé, jamais de bilan humain.
 * Le connecteur partage son cache avec l'ingestion des conflits (`intel.ts`).
 */
export const socialSources: FeedSourceDef[] = [
  {
    sourceId: "gdelt-events",
    sourceName: "GDELT 2.0 (événements presse)",
    category: "social",
    homepage: "https://www.gdeltproject.org/",
    license: "GDELT Project — utilisation libre avec citation",
    ttlMs: 15 * 60_000,
    errorTtlMs: 5 * 60_000,
    async load() {
      return fetchSocialFeed();
    },
  },
];
