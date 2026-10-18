import { NextResponse } from "next/server";
import { queryClusterEvents } from "@/server/intel";
import { filtersFromSearchParams } from "@/server/filters";


/**
 * POST /api/cluster
 * Détail d'un foyer : les événements contenus dans la cellule géographique
 * demandée. Corps : { filters, degrees, lat, lon }.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    filters?: Record<string, string>;
    degrees?: number;
    lat?: number;
    lon?: number;
    limit?: number;
    clusterId?: string;
  } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "corps invalide" }, { status: 400 });
  }
  if (body.filters != null && (typeof body.filters !== "object" || Array.isArray(body.filters) || Object.values(body.filters).some((value) => typeof value !== "string"))) {
    return NextResponse.json({ error: "filtres invalides" }, { status: 400 });
  }

  const params = new URLSearchParams(body.filters ?? {});
  const filters = filtersFromSearchParams(params);
  const rawDegrees = Number(body.degrees ?? 2.4);
  const degrees = Math.min(30, Math.max(0.25, rawDegrees));
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  if (typeof body.lat !== "number" || typeof body.lon !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180 || !Number.isFinite(rawDegrees) || (body.clusterId !== undefined && (typeof body.clusterId !== "string" || !body.clusterId || body.clusterId.length > 512))) {
    return NextResponse.json({ error: "coordonnées manquantes" }, { status: 400 });
  }

  const limit = Number(body.limit ?? 120);
  if (!Number.isInteger(limit) || limit < 1 || limit > 300) {
    return NextResponse.json({ error: "limite invalide" }, { status: 400 });
  }
  const data = await queryClusterEvents(filters, degrees, lat, lon, limit, body.clusterId);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
