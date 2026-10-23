import { instrumentRoute } from "@/server/observability/http";
import { NextResponse } from "next/server";
import { getDetectionSnapshot } from "@/server/detection";
import { guardPublicApi } from "@/server/publicApi/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = instrumentRoute("/api/detection", GETHandler);
async function GETHandler(request: Request) {
  const limited = await guardPublicApi(request, "detection");
  if (limited) return limited;
  const body = await getDetectionSnapshot();
  return NextResponse.json(body, { status: body.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
