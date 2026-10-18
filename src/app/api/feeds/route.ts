import { NextResponse, type NextRequest } from "next/server";
import { getFeeds } from "@/server/feeds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/feeds?category=&country=&limit= — flux mondiaux en direct (hors conflits armés). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limit = params.get("limit");
  try {
    const body = await getFeeds({ category: params.get("category"), country: params.get("country"), limit: limit ? Number(limit) : null });
    return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ error: "Les flux mondiaux sont momentanément indisponibles." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
