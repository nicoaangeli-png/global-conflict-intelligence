import "server-only";

/**
 * Masquage des secrets dans tout texte susceptible de sortir du serveur (messages
 * d'erreur de sources, sorties d'outils d'AURA, état de santé).
 */

const SECRET_ENV_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL|DATABASE_URL|DSN)/i;
const SECRET_QUERY = /([?&](?:api[_-]?key|key|token|access_token|auth|secret|password|sig|signature)=)[^&#\s]+/gi;
const BEARER = /\b(Bearer)\s+[\w.~+/=-]{8,}/gi;
const OPENAI_KEY = /\bsk-[\w-]{12,}/g;

/** Valeurs des variables d'environnement sensibles (≥ 8 caractères), relues à chaque appel. */
function secretValues(): string[] {
  const values: string[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length >= 8 && SECRET_ENV_NAME.test(name) && !/^(NEXT_PUBLIC_)/.test(name)) values.push(value);
  }
  return values;
}

/** Masque toute valeur secrète connue ou tout motif de jeton dans un texte. */
export function redactSecrets(text: string): string {
  let out = text.replace(SECRET_QUERY, "$1[secret]").replace(BEARER, "$1 [secret]").replace(OPENAI_KEY, "[secret]");
  for (const value of secretValues()) if (out.includes(value)) out = out.split(value).join("[secret]");
  return out;
}
