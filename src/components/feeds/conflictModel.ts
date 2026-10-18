/**
 * Vocabulaire honnête des données de conflit (logique pure, testée).
 *
 * Trois natures jamais additionnées : articles de presse (GDELT), incidents
 * vérifiés (UCDP/ACLED/import), détections satellite (FIRMS).
 */
import type { ConflictCluster, ConflictEvent, GeoPrecision, SourceAvailability } from "@/types/conflict";

export type ConflictNature = "press" | "verified" | "satellite";

/** Jeux de données par nature (filtre « Afficher »). */
export const NATURE_DATASETS: Record<ConflictNature, string[]> = {
  press: ["gdelt"],
  verified: ["acled", "ucdp", "import:csv"],
  satellite: ["firms"],
};

export function natureOfSource(source: Pick<SourceAvailability, "unit">): ConflictNature | null {
  switch (source.unit) {
    case "media_mention":
      return "press";
    case "incident_record":
    case "operator_import_record":
      return "verified";
    case "thermal_detection":
      return "satellite";
    default:
      return null; // enregistrements fictifs ou unité inconnue : jamais comptés
  }
}

/** Natures actives d'après la liste de jeux de données filtrée. */
export function activeNatures(datasets: readonly string[]): Set<ConflictNature> {
  const out = new Set<ConflictNature>();
  for (const [nature, list] of Object.entries(NATURE_DATASETS) as [ConflictNature, string[]][]) {
    if (list.some((d) => datasets.includes(d))) out.add(nature);
  }
  return out;
}

/** Bascule une nature ; refuse de tout désactiver (retourne null). */
export function toggleNature(datasets: readonly string[], nature: ConflictNature): string[] | null {
  const active = activeNatures(datasets);
  if (active.has(nature)) active.delete(nature);
  else active.add(nature);
  if (!active.size) return null;
  return [...active].flatMap((n) => NATURE_DATASETS[n]);
}

/** Décompte d'un foyer par nature. Les morts ne valent que pour les incidents vérifiés. */
export function clusterBreakdown(cluster: ConflictCluster): { press: number; satellite: number; verified: number; fatalities: number | null } {
  const press = cluster.confidenceCounts.MEDIA_SIGNAL ?? 0;
  const satellite = cluster.typeCounts["Thermal anomaly"] ?? 0;
  const verified = Math.max(0, cluster.eventCount - press - satellite);
  return { press, satellite, verified, fatalities: verified > 0 ? cluster.fatalities : null };
}

/** Résumé lisible d'un foyer, natures séparées : « 12 articles de presse · 2 détections satellite ». */
export function clusterSummary(cluster: ConflictCluster, locale: "fr" | "en"): string {
  const b = clusterBreakdown(cluster);
  const fr = locale === "fr";
  const parts: string[] = [];
  if (b.verified) parts.push(fr ? `${b.verified} incident${b.verified > 1 ? "s" : ""} vérifié${b.verified > 1 ? "s" : ""}` : `${b.verified} verified incident${b.verified > 1 ? "s" : ""}`);
  if (b.press) parts.push(fr ? `${b.press} article${b.press > 1 ? "s" : ""} de presse` : `${b.press} press article${b.press > 1 ? "s" : ""}`);
  if (b.satellite) parts.push(fr ? `${b.satellite} détection${b.satellite > 1 ? "s" : ""} satellite` : `${b.satellite} satellite detection${b.satellite > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

/**
 * Précision de localisation d'un foyer, si le serveur la fournit (champ additif
 * optionnel `geoPrecision`). Absent = comportement historique (point précis).
 */
export function clusterPrecision(cluster: ConflictCluster): GeoPrecision | null {
  const value = (cluster as ConflictCluster & { geoPrecision?: unknown }).geoPrecision;
  return value === "city" || value === "region" || value === "country" ? value : null;
}

/** Un foyer localisé au niveau pays ou région n'est jamais dessiné comme un point précis. */
export function isPointPrecise(cluster: ConflictCluster): boolean {
  const precision = clusterPrecision(cluster);
  return precision !== "country" && precision !== "region";
}

/** Mention de précision à afficher (null = point précis, rien à signaler). */
export function precisionLabel(precision: GeoPrecision | null | undefined, locale: "fr" | "en"): string | null {
  if (precision === "country") return locale === "fr" ? "localisé au niveau pays" : "located at country level";
  if (precision === "region") return locale === "fr" ? "localisé au niveau région" : "located at region level";
  return null;
}

export const eventPrecisionLabel = (event: ConflictEvent, locale: "fr" | "en") => precisionLabel(event.geoPrecision, locale);
