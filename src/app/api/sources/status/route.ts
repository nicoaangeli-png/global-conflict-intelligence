import { instrumentRoute } from "@/server/observability/http";
import { NextResponse } from "next/server";
import { sourcesStatus } from "@/server/health/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sources/status — santé normalisée de chaque source externe
 * (flux, connecteurs de la base de conflits, calques). Lecture du registre seulement.
 */
export const GET = instrumentRoute("/api/sources/status", GETHandler);
async function GETHandler() {
  return NextResponse.json(sourcesStatus(), { headers: { "Cache-Control": "no-store" } });
}
