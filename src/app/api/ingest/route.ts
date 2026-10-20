import { NextResponse } from "next/server";
import { healthInfo, runIngest } from "@/server/intel";
import { createHash, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

const gate = globalThis as unknown as { __orbitalIngestGate?: { nextAt: number; running: boolean } };
const ingestGate = (gate.__orbitalIngestGate ??= { nextAt: 0, running: false });


/** Jeton Bearer comparé à temps constant ; « disabled » si l'ingestion n'est pas configurée. */
function authorized(request: Request): "disabled" | "unauthorized" | "ok" {
  const token = process.env.INGEST_TOKEN;
  if (!token) return "disabled";
  const supplied = request.headers.get("authorization") ?? "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(supplied), digest(`Bearer ${token}`)) ? "ok" : "unauthorized";
}

/**
 * POST /api/ingest — lance le pipeline complet
 * (connecteurs → normalisation → déduplication → persistance → notification SSE).
 * GET  /api/ingest — état détaillé des connecteurs, réservé à l'exploitation :
 * même jeton que POST (les états publics sont déjà dans /api/health et
 * /api/sources/status, sans notes internes ni rapport d'ingestion).
 */
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const access = authorized(request);
  if (access === "disabled") return NextResponse.json({ error: "Ingestion disabled" }, { status: 503, headers });
  if (access === "unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
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

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const access = authorized(request);
  if (access === "disabled") return NextResponse.json({ error: "Ingestion disabled" }, { status: 503, headers });
  if (access === "unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  return NextResponse.json(healthInfo(), { headers });
}
