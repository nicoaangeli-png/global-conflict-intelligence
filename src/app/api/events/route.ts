import { NextResponse } from "next/server";
import { queryClusters } from "@/server/intel";
import { degreesFromSearchParams, filtersFromSearchParams } from "@/server/filters";


/**
 * GET /api/events
 * Renvoie les foyers AGRÉGÉS (jamais les événements bruts) pour la période
 * et les filtres demandés. `degrees` contrôle le rayon de regroupement en
 * fonction du niveau de zoom de la caméra.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filters = filtersFromSearchParams(searchParams);
  const degrees = degreesFromSearchParams(searchParams);

  try {
    const data = await queryClusters(filters, degrees);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "agrégation impossible" },
      { status: 500 },
    );
  }
}
