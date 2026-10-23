import { getBriefing, regenerateBriefing } from "@/server/briefing";
import { checkOrbitalOrigin, jsonResponse as json } from "@/server/aura/origin";
import { isJsonContentType, readBoundedText } from "@/server/aura/requestBody";
import { guardPublicApi } from "@/server/publicApi/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Régénération manuelle du bilan : même contrôle d'origine que les routes payantes
 * d'AURA (allowlist stricte `AURA_ALLOWED_ORIGINS`, aucun joker, `X-Orbital-Client`).
 * L'ancien contrôle local acceptait tout hôte `*.sslip.io` : il a été supprimé au profit
 * du module partagé, corrigé en phase 2.
 */

/** Bilan du jour (UTC) : généré à la première demande, puis servi depuis le cache. */
export async function GET(request: Request) {
  const limited = await guardPublicApi(request, "briefing");
  if (limited) return limited;
  try {
    return json(await getBriefing(), 200);
  } catch {
    return json({ error: "Bilan indisponible." }, 500);
  }
}

/** Régénération manuelle protégée, limitée à 1 / 10 min. */
export async function POST(request: Request) {
  const rejected = checkOrbitalOrigin(request);
  if (rejected) return rejected;
  if (!isJsonContentType(request)) return json({ error: "Content-Type application/json requis" }, 415);
  // Corps inutilisé mais lu de façon bornée : une longueur mensongère ou un corps
  // transmis par morceaux ne peut pas faire lire davantage que 1 Ko au serveur.
  const body = await readBoundedText(request, 1024);
  if (!body.ok) return json({ error: body.error }, body.status);
  const limited = await guardPublicApi(request, "briefing-write");
  if (limited) return limited;
  try {
    const result = await regenerateBriefing();
    if (!result.ok) return json({ error: "Régénération limitée à une fois toutes les 10 minutes." }, 429, { "Retry-After": String(result.retryAfterSec) });
    return json(result.briefing, 200);
  } catch {
    return json({ error: "Bilan indisponible." }, 500);
  }
}
