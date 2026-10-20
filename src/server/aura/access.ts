import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { jsonResponse } from "./origin";

/**
 * Authentification facultative d'AURA, distincte du contrôle d'origine.
 *
 * Sans `AURA_ACCESS_TOKEN`, AURA est publique (protégée par origine, débit et budgets).
 * Avec `AURA_ACCESS_TOKEN`, chaque requête doit porter `Authorization: Bearer <jeton>`.
 * L'interface web n'envoie pas ce jeton : ce mode vise un accès privé où le proxy
 * l'injecte après sa propre authentification (ex. Caddy `basic_auth` puis
 * `header_up Authorization "Bearer {env.AURA_ACCESS_TOKEN}"`), ou un usage par API.
 */

const digest = (value: string) => createHash("sha256").update(value).digest();

export function auraAccessRequired(): boolean {
  return Boolean((process.env.AURA_ACCESS_TOKEN ?? "").trim());
}

export function checkAuraAccess(request: Request): Response | null {
  const expected = (process.env.AURA_ACCESS_TOKEN ?? "").trim();
  if (!expected) return null;
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  // Comparaison à durée constante sur des empreintes de même longueur.
  if (!match || !timingSafeEqual(digest(match[1].trim()), digest(expected))) {
    return jsonResponse({ error: "authentification requise" }, 401, { "WWW-Authenticate": "Bearer" });
  }
  return null;
}
