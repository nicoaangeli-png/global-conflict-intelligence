import { NextResponse } from "next/server";
import { isLayerId, listLayers, loadLayer } from "@/server/layers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/layers?id=<LayerId> — calques de référence, hors événements. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  const headers = { "Cache-Control": "no-store" };
  if (id !== null && !isLayerId(id)) {
    return NextResponse.json({ error: "id must be a known LayerId" }, { status: 400, headers });
  }
  try {
    return NextResponse.json(id ? await loadLayer(id) : { layers: await listLayers() }, { headers });
  } catch {
    // Défense supplémentaire : loadLayer est déjà total, mais une route ne doit jamais divulguer une exception.
    return NextResponse.json({ error: "Les calques de référence sont momentanément indisponibles." }, { status: 503, headers });
  }
}
