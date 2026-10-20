import { NextResponse } from "next/server";
import { getDetectionSnapshot } from "@/server/detection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const body = await getDetectionSnapshot();
  return NextResponse.json(body, { status: body.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
