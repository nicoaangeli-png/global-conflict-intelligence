import "server-only";
import { log } from "@/server/observability/logger";
import { trustsProxy } from "./clientIdentity";

/**
 * Contrôle d'origine des routes payantes d'AURA (analyse et voix).
 *
 * Rôle : empêcher qu'une page tierce, ouverte dans le navigateur d'un visiteur,
 * déclenche AURA (CSRF, DNS rebinding). Ce n'est PAS une authentification : un
 * script hors navigateur peut fabriquer tous ces en-têtes. Les abus hors navigateur
 * relèvent de la limitation de débit, des budgets et, si besoin, de `AURA_ACCESS_TOKEN`.
 *
 * Règles :
 * - hôte servi : boucle locale (localhost, 127.0.0.1, [::1]) ou hôte d'une origine
 *   listée dans `AURA_ALLOWED_ORIGINS` (liste stricte, aucun joker) ;
 * - `Origin` présent : identique à une origine listée, ou boucle locale vers boucle locale ;
 *   absent : `Sec-Fetch-Site: same-origin` exigé ;
 * - `Sec-Fetch-Site` cross-site refusé ;
 * - en-tête `X-Orbital-Client: aura` : impose un contrôle CORS préalable au navigateur
 *   pour toute origine tierce (aucune réponse CORS n'étant émise, il échoue).
 * - `X-Forwarded-Host` n'est lu que derrière un proxy déclaré (`ORBITAL_TRUST_PROXY`).
 */

export function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const warned = new Set<string>();

function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  log("warn", "origin_configuration", { subsystem: "aura" });
}

/** Origines explicitement autorisées (`AURA_ALLOWED_ORIGINS`, séparées par des virgules). */
export function allowedOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const raw of (process.env.AURA_ALLOWED_ORIGINS ?? "").split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry.includes("*")) {
      warnOnce(`AURA_ALLOWED_ORIGINS : joker ignoré (${entry}) ; lister chaque origine.`);
      continue;
    }
    try {
      const url = new URL(entry);
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) origins.add(url.origin.toLowerCase());
      else warnOnce(`AURA_ALLOWED_ORIGINS : origine ignorée (${url.protocol}).`);
    } catch {
      warnOnce("AURA_ALLOWED_ORIGINS : entrée illisible ignorée.");
    }
  }
  return origins;
}

function parseHost(host: string): { host: string; hostname: string } | null {
  if (!host || /[\s/@]/.test(host)) return null;
  try {
    const url = new URL(`http://${host}`);
    return { host: url.host.toLowerCase(), hostname: url.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

const isLoopback = (hostname: string) => LOOPBACK_HOSTNAMES.has(hostname);

export function checkOrbitalOrigin(request: Request): Response | null {
  const allowed = allowedOrigins();
  const allowedHosts = new Set([...allowed].map((origin) => new URL(origin).host));

  const forwarded = trustsProxy() ? request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() : "";
  const served = parseHost((forwarded || request.headers.get("host") || "").toLowerCase());
  if (!served || !(isLoopback(served.hostname) || allowedHosts.has(served.host))) {
    if (served && !allowed.size) warnOnce("AURA_ALLOWED_ORIGINS vide : AURA n'est servie qu'en boucle locale.");
    return jsonResponse({ error: "hôte non autorisé" }, 403);
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
    return jsonResponse({ error: "origine non autorisée" }, 403);
  }

  const origin = request.headers.get("origin");
  if (origin) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return jsonResponse({ error: "origine invalide" }, 403);
    }
    const value = parsed.origin.toLowerCase();
    const sameLoopback = isLoopback(parsed.hostname.toLowerCase()) && isLoopback(served.hostname);
    if (!allowed.has(value) && !sameLoopback) return jsonResponse({ error: "origine non autorisée" }, 403);
  } else if (fetchSite !== "same-origin") {
    return jsonResponse({ error: "origine requise" }, 403);
  }

  if (request.headers.get("x-orbital-client") !== "aura") {
    return jsonResponse({ error: "client non autorisé" }, 403);
  }
  return null;
}
