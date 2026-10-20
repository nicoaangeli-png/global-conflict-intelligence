import { NextResponse } from "next/server";
import { applicationHealth } from "@/server/health/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/health — état de l'application (supervision). Aucun appel réseau. */
export async function GET() {
  return NextResponse.json(applicationHealth(), { headers: { "Cache-Control": "no-store" } });
}
