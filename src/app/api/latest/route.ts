import { NextResponse } from "next/server";
import { queryLatestEvents } from "@/server/intel";
import { filtersFromSearchParams } from "@/server/filters";


/**
 * GET /api/latest — derniers événements (vue « LIVE EVENTS »).
 * Les événements sont renvoyés normalisés, triés du plus récent au plus ancien.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filters = filtersFromSearchParams(searchParams);
  const limit = Number(searchParams.get("limit") ?? 60);
  if (!Number.isInteger(limit) || limit < 1 || limit > 400) {
    return NextResponse.json(
      { error: "limit doit être un entier compris entre 1 et 400." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
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
