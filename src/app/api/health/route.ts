import { instrumentRoute } from "@/server/observability/http";
import { NextResponse } from "next/server";
import { applicationHealth } from "@/server/health/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/health — état de l'application (supervision). Aucun appel réseau. */
export const GET = instrumentRoute("/api/health", GETHandler);
async function GETHandler() {
  return NextResponse.json(applicationHealth(), { headers: { "Cache-Control": "no-store" } });
}
