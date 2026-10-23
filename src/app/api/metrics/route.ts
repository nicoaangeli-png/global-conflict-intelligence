import { createHash, timingSafeEqual } from "node:crypto";
import { instrumentRoute } from "@/server/observability/http";
import { exportMetrics } from "@/server/observability/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = instrumentRoute("/api/metrics", async (request) => {
  const expected = process.env.ORBITAL_METRICS_TOKEN;
  if (!expected && process.env.NODE_ENV === "production") return new Response("Metrics unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  if (expected) {
    const supplied = request.headers.get("authorization")?.match(/^Bearer ([^\s]{1,512})$/)?.[1] ?? "";
    const left = createHash("sha256").update(supplied).digest();
    const right = createHash("sha256").update(expected).digest();
    if (!timingSafeEqual(left, right)) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(exportMetrics(), { headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" } });
});
