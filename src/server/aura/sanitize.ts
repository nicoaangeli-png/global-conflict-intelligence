import "server-only";

/**
 * Assainissement des données transmises au modèle et renvoyées au navigateur.
 *
 * - Les textes externes (sources, outils, contexte de l'écran) sont des DONNÉES :
 *   caractères de contrôle retirés, motifs d'instruction neutralisés, longueur bornée,
 *   secrets connus masqués.
 * - Les URL ne sont conservées que si elles sont publiques et sans identifiants.
 */

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
const INSTRUCTION_PATTERN =
  /(ignor\w*|oubli\w*|disregard|forget)[^.\n]{0,50}(instruction|consigne|prompt|règle|regle|rule)|system prompt|prompt système|prompt systeme|you are now|tu es désormais|tu es desormais|developer message|<\/?[\w:-]+(?:\s[^<>]*)?>/gi;
const REDACTION = "[texte retiré : tentative d'instruction]";

export type SanitizeReport = { redacted: number; truncated: number };

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

export function cleanText(value: unknown, maxLength: number, report?: SanitizeReport): string {
  if (typeof value !== "string") return "";
  let text = redactSecrets(value.replace(CONTROL_CHARACTERS, " ").replace(/\s{2,}/g, " ").trim());
  if (INSTRUCTION_PATTERN.test(text)) {
    INSTRUCTION_PATTERN.lastIndex = 0;
    text = text.replace(INSTRUCTION_PATTERN, REDACTION);
    if (report) report.redacted += 1;
  }
  INSTRUCTION_PATTERN.lastIndex = 0;
  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength)}…`;
    if (report) report.truncated += 1;
  }
  return text;
}

const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet"];

function isPrivateIpv4(hostname: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/**
 * URL http(s) publique, sans identifiants, ou null. Refuse les hôtes locaux, privés,
 * à un seul libellé et les adresses IPv6 littérales (jamais des sources publiques
 * d'ORBITAL). La validation est syntaxique : aucune résolution DNS.
 */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 600) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.includes(".") || hostname.startsWith("[") || hostname === "localhost") return null;
  if (PRIVATE_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) || isPrivateIpv4(hostname)) return null;
  const href = parsed.toString();
  return redactSecrets(href) === href ? href : null;
}

export function sanitizeTree(node: unknown, report: SanitizeReport, depth = 0): unknown {
  if (depth > 6) return null;
  if (typeof node === "string") return cleanText(node, 240, report);
  if (Array.isArray(node)) return node.slice(0, 40).map((entry) => sanitizeTree(entry, report, depth + 1));
  if (node && typeof node === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(node as Record<string, unknown>)) {
      cleaned[key] = /url$/i.test(key) ? (safeHttpUrl(entry) ?? undefined) : sanitizeTree(entry, report, depth + 1);
    }
    return cleaned;
  }
  return node;
}

/** Libellé de lieu fourni par l'interface : lettres, chiffres, espaces et ponctuation de noms propres. */
const PLACE_LABEL = /^[\p{L}\p{M}\p{N} .,'’()-]{1,80}$/u;

/** Nom de lieu ou de pays issu du contexte de l'écran, ou "" s'il contient autre chose qu'un nom. */
export function cleanPlaceLabel(value: unknown, maxLength = 80): string {
  const text = cleanText(value, maxLength);
  return text && !text.includes("[") && PLACE_LABEL.test(text) ? text : "";
}
