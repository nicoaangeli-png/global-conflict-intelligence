import type { ConflictEvent } from "@/types/conflict";

/**
 * Contrat commun à tous les connecteurs de données.
 * Chaque connecteur renvoie des événements DÉJÀ normalisés : le frontend
 * ne voit jamais un format brut d'API externe.
 */
export interface Connector {
  id: "acled" | "gdelt" | "ucdp" | "firms" | "csv";
  label: string;
  /** Le connecteur est-il utilisable (identifiants / fichiers présents) ? */
  isConfigured(): boolean;
  /** Récupère et normalise les événements. */
  fetchEvents(options: { days: number }): Promise<ConflictEvent[]>;
  /** Message d'état affiché dans l'interface. */
  describe(): string;
  /** Optionnel : résumé du dernier passage (rejets, avertissements), ajouté au rapport d'ingestion. */
  lastReport?(): string | null;
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
      throw new ConnectorError(`${connector}: HTTP ${res.status}`, connector, "network");
    }
    return res;
  } catch (err) {
    if (err instanceof ConnectorError) throw err;
    throw new ConnectorError(
      `${connector}: requête impossible`,
      connector,
      "network",
    );
  }
}

export function providerDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z?$/.exec(raw);
  const normalized = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`
    : /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z`
    : /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw) ? `${raw.replace(" ", "T")}Z` : raw;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

/**
 * Date calendaire stricte `YYYY-MM-DD` (heure optionnelle) : refuse les jours
 * inexistants (`2026-02-31`), que `Date.parse` accepte et décale silencieusement.
 */
export function strictIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?)?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h = 12, mi = 0, sec = 0] = m.slice(1).map((x, i) => (x === undefined ? undefined : Number(x))) as number[];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  if (h > 23 || mi > 59 || sec > 59) return null;
  return date.toISOString();
}

export function validCoordinates(latitude: unknown, longitude: unknown): boolean {
  return latitude !== "" && longitude !== "" && latitude != null && longitude != null &&
    Number.isFinite(Number(latitude)) && Math.abs(Number(latitude)) <= 90 &&
    Number.isFinite(Number(longitude)) && Math.abs(Number(longitude)) <= 180;
}

/** Accès aux variables d'environnement côté serveur uniquement. */
export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length ? v : undefined;
}
