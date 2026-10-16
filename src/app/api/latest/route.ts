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
  const limit = Math.min(400, Math.max(1, Number(searchParams.get("limit") ?? 60)));
  const events = await queryLatestEvents(filters, limit);
  return NextResponse.json(
    { generatedAt: new Date().toISOString(), count: events.length, events },
    { headers: { "Cache-Control": "no-store" } },
  );
}
