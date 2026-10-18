import "server-only";

/**
 * Contrôle d'origine partagé par les routes d'AURA (analyse et synthèse vocale).
 *
 * Une route d'AURA ne doit jamais répondre à un site tiers : hôte local ou
 * explicitement autorisé (AURA_ALLOWED_ORIGINS), origine cohérente et en-tête
 * client dédié. Ces règles sont identiques pour la voix et pour l'analyse.
 */

export function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function configuredOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const entry of (process.env.AURA_ALLOWED_ORIGINS ?? "").split(",")) {
    try {
      if (entry.trim()) origins.add(new URL(entry.trim()).origin.toLowerCase());
    } catch {
      continue;
    }
  }
  return origins;
}

function hostnameOf(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLocalHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^\[.*\]$/.test(hostname) ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
  );
}

export function checkOrbitalOrigin(request: Request): Response | null {
  const allowed = configuredOrigins();
  const allowedHosts = new Set([...allowed].map((origin) => new URL(origin).host.toLowerCase()));
  const fwdHost = (request.headers.get("x-forwarded-host") ?? "").toLowerCase();
  const rawHost = (request.headers.get("host") ?? "").toLowerCase();
  const candHosts = [fwdHost, rawHost].filter(Boolean);

  const host = fwdHost || rawHost;
  const hostname = hostnameOf(host);
  const isAllowedHost =
    isLocalHostname(hostname ?? "") ||
    allowedHosts.has(host) ||
    (hostname?.endsWith(".sslip.io") ?? false) ||
    candHosts.some((h) => allowedHosts.has(h) || (hostnameOf(h)?.endsWith(".sslip.io") ?? false));

  if (!host || !hostname || !isAllowedHost) {
    return jsonResponse({ error: "hôte non autorisé" }, 403);
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none" && fetchSite !== "same-site") {
    return jsonResponse({ error: "origine non autorisée" }, 403);
  }

  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string;
    let originValue: string;
    try {
      const parsed = new URL(origin);
      originHost = parsed.host.toLowerCase();
      originValue = parsed.origin.toLowerCase();
    } catch {
      return jsonResponse({ error: "origine invalide" }, 403);
    }

    const originHostname = hostnameOf(originHost) ?? originHost;
    const isSameHost =
      candHosts.some((h) => {
        const hName = hostnameOf(h) ?? h;
        return originHost === h || originHostname === hName;
      }) ||
      originHostname.endsWith(".sslip.io") ||
      (candHosts.some((h) => isLocalHostname(hostnameOf(h) ?? h)) &&
        (originHostname.endsWith(".sslip.io") || isLocalHostname(originHostname)));

    if (!isSameHost && !allowed.has(originValue)) {
      return jsonResponse({ error: "origine non autorisée" }, 403);
    }
  } else if (fetchSite !== "same-origin" && fetchSite !== "none") {
    return jsonResponse({ error: "origine requise" }, 403);
  }

  if (request.headers.get("x-orbital-client") !== "aura") {
    return jsonResponse({ error: "client non autorisé" }, 403);
  }
  return null;
}
