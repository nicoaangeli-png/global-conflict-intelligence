import type { ConflictEvent } from "@/types/conflict";

/**
 * Contrat commun à tous les connecteurs de données.
 * Chaque connecteur renvoie des événements DÉJÀ normalisés : le frontend
 * ne voit jamais un format brut d'API externe.
 */
export interface Connector {
  id: "acled" | "gdelt" | "ucdp" | "csv";
  label: string;
  /** Le connecteur est-il utilisable (identifiants / fichiers présents) ? */
  isConfigured(): boolean;
  /** Récupère et normalise les événements. */
  fetchEvents(options: { days: number }): Promise<ConflictEvent[]>;
  /** Message d'état affiché dans l'interface. */
  describe(): string;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly connector: string,
    readonly kind: "config" | "network" | "parse" = "network",
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

/** Wrapper fetch avec délai maximal et erreurs normalisées. */
export async function safeFetch(
  connector: string,
  url: string,
  init: RequestInit = {},
  timeoutMs = 12000,
): Promise<Response> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok) {
      throw new ConnectorError(`${connector}: HTTP ${res.status} ${res.statusText}`, connector, "network");
    }
    return res;
  } catch (err) {
    if (err instanceof ConnectorError) throw err;
    throw new ConnectorError(
      `${connector}: ${err instanceof Error ? err.message : "requête impossible"}`,
      connector,
      "network",
    );
  }
}

/** Accès aux variables d'environnement côté serveur uniquement. */
export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length ? v : undefined;
}
