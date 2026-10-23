import { NextResponse } from "next/server";
import { isLayerId, listLayers, loadLayer } from "@/server/layers";
import { guardPublicApi } from "@/server/publicApi/limits";
import { validatePublicQuery } from "@/server/publicApi/parameters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/layers?id=<LayerId>[&country=<ISO3>] — calques de référence, hors événements.
 * `country` ne renvoie que les éléments rattachés à ce pays (fiche pays) : le calque
 * complet (jusqu'à ~750 Ko) n'est chargé par le navigateur que s'il est affiché.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const invalid = validatePublicQuery(params);
  if (invalid) return invalid;
  const id = params.get("id");
  const country = params.get("country");
  const headers = { "Cache-Control": "no-store" };
  if (id !== null && !isLayerId(id)) {
    return NextResponse.json({ error: "id must be a known LayerId" }, { status: 400, headers });
  }
  if (country !== null && (!id || !/^[A-Z]{3}$/.test(country))) {
    return NextResponse.json({ error: "country must be an ISO3 code, with id" }, { status: 400, headers });
  }
  const limited = await guardPublicApi(request, "layers");
  if (limited) return limited;
  try {
    if (!id) return NextResponse.json({ layers: await listLayers() }, { headers });
    const layer = await loadLayer(id);
    const body = country ? { ...layer, features: layer.features.filter((feature) => feature.countries.includes(country)) } : layer;
    return NextResponse.json(body, { headers });
  } catch {
    // Défense supplémentaire : loadLayer est déjà total, mais une route ne doit jamais divulguer une exception.
    return NextResponse.json({ error: "Les calques de référence sont momentanément indisponibles." }, { status: 503, headers });
  }
}
