import { NextResponse, type NextRequest } from "next/server";
import { countryCoverageCells, coverageFor, type CoverageQuery } from "@/server/coverage";
import { loadWorldIndex } from "@/server/world";
import { guardPublicApi } from "@/server/publicApi/limits";
import { validatePublicQuery } from "@/server/publicApi/parameters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

/**
 * GET /api/coverage[?country=FRA][&lat=&lon=] — qualité probable de l'observation ADS-B
 * et AIS (monde entier, zone d'un pays ou voisinage d'un point). Lecture mémoire seulement :
 * aucun appel aux fournisseurs. Ce n'est pas une mesure de l'activité.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const invalid = validatePublicQuery(params);
  if (invalid) return invalid;
  const country = params.get("country")?.trim().toUpperCase() ?? "";
  const latRaw = params.get("lat");
  const lonRaw = params.get("lon");
  let point: { lat: number; lon: number } | null = null;
  if (latRaw !== null || lonRaw !== null) {
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (latRaw === null || lonRaw === null || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return NextResponse.json({ error: "Coordonnées invalides." }, { status: 400, headers });
    }
    point = { lat, lon };
  }
  let query: CoverageQuery = point ? { kind: "point", ...point } : { kind: "global" };
  if (country && !/^[A-Z]{3}$/.test(country)) return NextResponse.json({ error: "Code pays ISO alpha-3 attendu." }, { status: 400, headers });
  const limited = await guardPublicApi(request, "coverage");
  if (limited) return limited;
  if (country) {
    const cells = countryCoverageCells(await loadWorldIndex(), country);
    // Pays trop petit pour le fond de carte (Singapour…) : voisinage de son centre, si fourni.
    if (cells) query = { kind: "country", iso: country, cells };
    else if (point) query = { kind: "point", ...point, id: country };
    else return NextResponse.json({ error: "Pays inconnu du référentiel." }, { status: 404, headers });
  }
  return NextResponse.json(coverageFor(query), { headers });
}
