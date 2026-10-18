import { getBriefing, regenerateBriefing } from "@/server/briefing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

// Mêmes vérifications que /api/agent (hôte, Origin same-host, X-Orbital-Client).
function configuredOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const entry of (process.env.AURA_ALLOWED_ORIGINS ?? "").split(",")) {
    try {
      if (entry.trim()) origins.add(new URL(entry.trim()).origin);
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
  return hostname === "localhost" || hostname.endsWith(".localhost") || /^\[.*\]$/.test(hostname) || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function checkOrigin(request: Request): Response | null {
  const allowed = configuredOrigins();
  const allowedHosts = new Set([...allowed].map((origin) => new URL(origin).host.toLowerCase()));
  const trustProxy = process.env.AURA_TRUST_PROXY === "1";
  const host = ((trustProxy ? request.headers.get("x-forwarded-host") : null) ?? request.headers.get("host") ?? "").toLowerCase();
  const hostname = hostnameOf(host);
  if (!host || !hostname || !(isLocalHostname(hostname) || allowedHosts.has(host))) return json({ error: "hôte non autorisé" }, 403);

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return json({ error: "origine non autorisée" }, 403);

  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string;
    let originValue: string;
    try {
      const parsed = new URL(origin);
      originHost = parsed.host.toLowerCase();
      originValue = parsed.origin;
    } catch {
      return json({ error: "origine invalide" }, 403);
    }
    if (originHost !== host && !allowed.has(originValue)) return json({ error: "origine non autorisée" }, 403);
  } else if (fetchSite !== "same-origin") {
    return json({ error: "origine requise" }, 403);
  }

  if (request.headers.get("x-orbital-client") !== "aura") return json({ error: "client non autorisé" }, 403);
  return null;
}

/** Bilan du jour (UTC) : généré à la première demande, puis servi depuis le cache. */
export async function GET() {
  try {
    return json(await getBriefing(), 200);
  } catch {
    return json({ error: "Bilan indisponible." }, 500);
  }
}

/** Régénération manuelle protégée, limitée à 1 / 10 min. */
export async function POST(request: Request) {
  const rejected = checkOrigin(request);
  if (rejected) return rejected;
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return json({ error: "Content-Type application/json requis" }, 415);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 1024) return json({ error: "corps trop volumineux" }, 413);
  try {
    const result = await regenerateBriefing();
    if (!result.ok) return json({ error: "Régénération limitée à une fois toutes les 10 minutes." }, 429, { "Retry-After": String(result.retryAfterSec) });
    return json(result.briefing, 200);
  } catch {
    return json({ error: "Bilan indisponible." }, 500);
  }
}
