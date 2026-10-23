import { instrumentRoute } from "@/server/observability/http";
import { NextResponse } from "next/server";
import { queryLatestEvents } from "@/server/intel";
import { filtersFromSearchParams } from "@/server/filters";
import { guardPublicApi } from "@/server/publicApi/limits";
import { validatePublicFilters } from "@/server/publicApi/parameters";


/**
 * GET /api/latest — derniers événements (vue « LIVE EVENTS »).
 * Les événements sont renvoyés normalisés, triés du plus récent au plus ancien.
 */
export const GET = instrumentRoute("/api/latest", GETHandler);
async function GETHandler(request: Request) {
  const { searchParams } = new URL(request.url);
  const invalid = validatePublicFilters(searchParams);
  if (invalid) return invalid;
  const filters = filtersFromSearchParams(searchParams);
  const limit = Number(searchParams.get("limit") ?? 60);
  if (!Number.isInteger(limit) || limit < 1 || limit > 400) {
    return NextResponse.json(
      { error: "limit doit être un entier compris entre 1 et 400." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const limited = await guardPublicApi(request, "latest");
  if (limited) return limited;
  try {
    const events = await queryLatestEvents(filters, limit);
    return NextResponse.json(
      { generatedAt: new Date().toISOString(), count: events.length, events },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Données temporairement indisponibles." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
