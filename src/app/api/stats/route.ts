import { NextResponse } from "next/server";
import { queryStats } from "@/server/intel";
import { degreesFromSearchParams, filtersFromSearchParams } from "@/server/filters";


/** GET /api/stats — indicateurs du panneau « GLOBAL SITUATION ». */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filters = filtersFromSearchParams(searchParams);
  const degrees = degreesFromSearchParams(searchParams);
  try {
    const stats = await queryStats(filters, degrees);
    return NextResponse.json(stats, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Données temporairement indisponibles." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
