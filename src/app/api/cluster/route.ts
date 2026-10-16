import { NextResponse } from "next/server";
import { queryClusterEvents } from "@/server/intel";
import { filtersFromSearchParams } from "@/server/filters";


/**
 * POST /api/cluster
 * Détail d'un foyer : les événements contenus dans la cellule géographique
 * demandée. Corps : { filters, degrees, lat, lon }.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const body = (await request.json().catch(() => ({}))) as {
    filters?: Record<string, string>;
    degrees?: number;
    lat?: number;
    lon?: number;
    limit?: number;
  };

  const params = new URLSearchParams(body.filters ?? {});
  const filters = filtersFromSearchParams(params);
  const degrees = Math.min(30, Math.max(0.25, Number(body.degrees) || 2.4));
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "coordonnées manquantes" }, { status: 400 });
  }

  const data = await queryClusterEvents(filters, degrees, lat, lon, Math.min(300, body.limit ?? 120));
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
