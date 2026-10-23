import { NextResponse } from "next/server";
import { getDetectionSnapshot } from "@/server/detection";
import { guardPublicApi } from "@/server/publicApi/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = await guardPublicApi(request, "detection");
  if (limited) return limited;
  const body = await getDetectionSnapshot();
  return NextResponse.json(body, { status: body.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
