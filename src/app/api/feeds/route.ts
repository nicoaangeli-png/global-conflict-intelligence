import { instrumentRoute } from "@/server/observability/http";
import { NextResponse, type NextRequest } from "next/server";
import { getFeeds } from "@/server/feeds";
import { guardPublicApi } from "@/server/publicApi/limits";
import { validatePublicQuery } from "@/server/publicApi/parameters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/feeds?category=&country=&limit= — flux mondiaux en direct (hors conflits armés). */
export const GET = instrumentRoute("/api/feeds", GETHandler);
async function GETHandler(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const invalid = validatePublicQuery(params);
  if (invalid) return invalid;
  const limit = params.get("limit");
  if (limit !== null && (!Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 1000)) return NextResponse.json({ error: "limit invalide" }, { status: 400 });
  const limited = await guardPublicApi(request, "feeds");
  if (limited) return limited;
  try {
    const body = await getFeeds({ category: params.get("category"), country: params.get("country"), limit: limit ? Number(limit) : null });
    return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ error: "Les flux mondiaux sont momentanément indisponibles." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
