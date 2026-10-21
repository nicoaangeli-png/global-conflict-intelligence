import "server-only";

/**
 * Identité réseau du client, pour la limitation de débit uniquement (jamais une
 * authentification).
 *
 * Next.js ne transmet pas l'adresse de la connexion aux routes : seule une adresse
 * écrite par un proxy de confiance est exploitable. Par défaut, AUCUN en-tête
 * n'est cru (`X-Forwarded-For`, `CF-Connecting-IP`… sont falsifiables par le
 * client) : tous les clients partagent alors la même clé, donc les mêmes limites.
 *
 * `ORBITAL_TRUST_PROXY=1` déclare UN proxy de confiance (Caddy, nginx) qui écrit ou
 * complète `X-Forwarded-For`. Conditions : l'application n'est joignable QUE par ce
 * proxy (pare-feu ou écoute sur 127.0.0.1). L'entrée la plus à droite, ajoutée par
 * le proxy lui-même, est alors l'adresse du client. `AURA_TRUST_PROXY=1` (ancien nom)
 * reste accepté.
 */

const IP_PATTERN = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]{2,39})$/i;

export function trustsProxy(): boolean {
  const value = (process.env.ORBITAL_TRUST_PROXY || process.env.AURA_TRUST_PROXY || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "single";
}

/** Clé de limitation du client : `ip:<adresse>` derrière un proxy de confiance, sinon `anonymous`. */
export function clientKey(request: Request): string {
  if (!trustsProxy()) return "anonymous";
  const entries = (request.headers.get("x-forwarded-for") ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const nearest = entries.at(-1);
  return nearest && IP_PATTERN.test(nearest) ? `ip:${nearest.toLowerCase()}` : "anonymous";
}
