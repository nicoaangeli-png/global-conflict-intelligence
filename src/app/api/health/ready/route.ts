import { instrumentRoute } from "@/server/observability/http";
import { checkReadiness } from "@/server/health/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = instrumentRoute("/api/health/ready", async () => {
  const readiness = await checkReadiness();
  return Response.json(readiness, { status: readiness.status === "ready" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
});
