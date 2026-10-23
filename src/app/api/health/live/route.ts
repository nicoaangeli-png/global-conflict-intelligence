import { instrumentRoute } from "@/server/observability/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = instrumentRoute("/api/health/live", async () => Response.json({ status: "alive", uptimeSeconds: Math.round(process.uptime()) }, { headers: { "Cache-Control": "no-store" } }));
