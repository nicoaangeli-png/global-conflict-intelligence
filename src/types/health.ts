/**
 * Santé normalisée des sources externes d'ORBITAL (flux mondiaux, connecteurs de la
 * base de conflits, calques de référence). Partagée par le serveur, l'interface et AURA.
 *
 * - healthy      : dernière tentative réussie, données complètes.
 * - degraded     : dernière tentative réussie mais partielle (avertissement de la source).
 * - stale        : dernière tentative en échec ; les dernières données valides restent servies,
 *                  ou le dernier succès est plus ancien que la fraîcheur attendue.
 * - unavailable  : aucune donnée exploitable (échec sans cache valide).
 * - unconfigured : source non branchée (clé absente, désactivée volontairement).
 * - pending      : pas encore interrogée depuis le démarrage du serveur.
 */
export const SOURCE_HEALTH_STATUSES = ["healthy", "degraded", "stale", "unavailable", "unconfigured", "pending"] as const;
export type SourceHealthStatus = (typeof SOURCE_HEALTH_STATUSES)[number];

export type SourceKind = "feed" | "connector" | "layer" | "camera";

export interface SourceHealth {
  /** Identifiant stable, préfixé par la famille (`feed:usgs`, `connector:ucdp`, `layer:sanctions`). */
  id: string;
  kind: SourceKind;
  name: string;
  /** Catégorie de flux, `conflicts` pour les connecteurs, `reference` pour les calques. */
  category: string;
  status: SourceHealthStatus;
  /** Dernière tentative d'interrogation (ISO), réussie ou non. */
  lastAttemptAt: string | null;
  /** Dernière interrogation réussie (ISO). */
  lastSuccessAt: string | null;
  /** Date propre (événement ou publication) de la donnée la plus récente reçue (ISO). */
  newestDataAt: string | null;
  /** Âge de cette donnée au moment du calcul (ms), ou null si inconnue. */
  dataAgeMs: number | null;
  /** Durée de la dernière tentative (ms). */
  latencyMs: number | null;
  /** Nombre d'éléments récupérés lors du dernier succès (ou servis depuis le cache). */
  itemCount: number;
  /** Dernière erreur connue, lisible et sans détail sensible. */
  lastError: string | null;
  /** Provenance : page de la source, licence, nature des données. */
  provenance: { homepage: string | null; license: string | null; nature: string | null };
  /** Limite ou quota connu de la source, en clair. */
  quota: string | null;
}

export interface SourcesStatusResponse {
  generatedAt: string;
  summary: Record<SourceHealthStatus, number>;
  sources: SourceHealth[];
}
