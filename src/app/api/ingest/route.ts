import { NextResponse } from "next/server";
import { healthInfo, runIngest } from "@/server/intel";
import { createHash, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

const gate = globalThis as unknown as { __orbitalIngestGate?: { nextAt: number; running: boolean } };
const ingestGate = (gate.__orbitalIngestGate ??= { nextAt: 0, running: false });


/**
 * POST /api/ingest — lance le pipeline complet
 * (connecteurs → normalisation → déduplication → persistance → notification SSE).
 * GET  /api/ingest — état des connecteurs.
 */
export async function POST(request: Request) {
  const token = process.env.INGEST_TOKEN;
  const headers = { "Cache-Control": "no-store" };
  if (!token) return NextResponse.json({ error: "Ingestion disabled" }, { status: 503, headers });
  const supplied = request.headers.get("authorization") ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(supplied), digest(`Bearer ${token}`))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return NextResponse.json({ error: "days must be an integer from 1 to 365" }, { status: 400, headers });
  }
  if (ingestGate.running || Date.now() < ingestGate.nextAt) {
    return NextResponse.json({ error: "Ingestion rate limited" }, {
      status: 429,
      headers: { ...headers, "Retry-After": String(Math.max(1, Math.ceil((ingestGate.nextAt - Date.now()) / 1000))) },
    });
  }
  ingestGate.running = true;
  ingestGate.nextAt = Date.now() + 60_000;
  try {
    const result = await runIngest({ days });
    return NextResponse.json(result, { headers });
  } catch {
    return NextResponse.json({ error: "Ingestion unavailable" }, { status: 503, headers });
  } finally {
    ingestGate.running = false;
  }
}

export async function GET() {
  return NextResponse.json(healthInfo(), { headers: { "Cache-Control": "no-store" } });
}
