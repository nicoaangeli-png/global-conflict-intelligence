import { NextResponse } from "next/server";
import { queryClusterEvents } from "@/server/intel";
import { filtersFromSearchParams } from "@/server/filters";
import { isJsonContentType, readBoundedText } from "@/server/aura/requestBody";
import { guardPublicApi } from "@/server/publicApi/limits";
import { validatePublicFilters } from "@/server/publicApi/parameters";

/** Bornes du corps : le détail d'un foyer tient en quelques centaines d'octets. */
const CLUSTER_BODY_BYTES = 16 * 1024;

/**
 * POST /api/cluster
 * Détail d'un foyer : les événements contenus dans la cellule géographique
 * demandée. Corps : { filters, degrees, lat, lon }.
 * Corps borné (16 Ko) et lû sans dépasser la mémoire : une requête ne doit jamais
 * pouvoir forcer le serveur à lire un corps arbitrairement grand.
 */
export async function POST(request: Request) {
  if (!isJsonContentType(request)) {
    return NextResponse.json({ error: "Content-Type application/json requis" }, { status: 415 });
  }
  const raw = await readBoundedText(request, CLUSTER_BODY_BYTES);
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status });
  let body: {
    filters?: Record<string, string>;
    degrees?: number;
    lat?: number;
    lon?: number;
    limit?: number;
    clusterId?: string;
  } | null;
  try {
    body = JSON.parse(raw.text) as typeof body;
  } catch {
    return NextResponse.json({ error: "corps invalide" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "corps invalide" }, { status: 400 });
  }
  if (body.filters != null && (typeof body.filters !== "object" || Array.isArray(body.filters) || Object.values(body.filters).some((value) => typeof value !== "string"))) {
    return NextResponse.json({ error: "filtres invalides" }, { status: 400 });
  }

  const params = new URLSearchParams(body.filters ?? {});
  const invalid = validatePublicFilters(params);
  if (invalid) return invalid;
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
  const limited = await guardPublicApi(request, "cluster");
  if (limited) return limited;
  const data = await queryClusterEvents(filters, degrees, lat, lon, limit, body.clusterId);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
