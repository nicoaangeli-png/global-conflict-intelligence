import { NextResponse } from "next/server";
import { healthInfo, runIngest } from "@/server/intel";


/**
 * POST /api/ingest — lance le pipeline complet
 * (connecteurs → normalisation → déduplication → persistance → notification SSE).
 * GET  /api/ingest — état des connecteurs.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? 30)));
  const result = await runIngest({ days });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return NextResponse.json(healthInfo(), { headers: { "Cache-Control": "no-store" } });
}
