import { instrumentRoute } from "@/server/observability/http";
import { guardPublicApi } from "@/server/publicApi/limits";
import { cameraFrame } from "@/server/cameras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = instrumentRoute("/api/cameras/frame", async (request: Request) => {
  if (new URL(request.url).search) return Response.json({ error: "Paramètres interdits" }, { status: 400 });
  const cameraId = new URL(request.url).pathname.match(/^\/api\/cameras\/(C\d{5,12})\/frame$/)?.[1] ?? "";
  if (!/^C\d{5,12}$/.test(cameraId)) return Response.json({ error: "Identifiant invalide" }, { status: 400 });
  const limited = await guardPublicApi(request, "camera-frame");
  if (limited) return limited;
  try {
    const frame = await cameraFrame(cameraId);
    return frame ? new Response(Buffer.from(frame), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=60, stale-while-revalidate=540", "X-Content-Type-Options": "nosniff" } }) : Response.json({ error: "Image indisponible" }, { status: 404 });
  } catch { return Response.json({ error: "Image Fintraffic indisponible" }, { status: 502, headers: { "Cache-Control": "no-store" } }); }
});
