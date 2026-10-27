import { instrumentRoute } from "@/server/observability/http";
import { guardPublicApi } from "@/server/publicApi/limits";
import { cameraById } from "@/server/cameras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = instrumentRoute("/api/cameras/detail", async (request: Request) => {
  if (new URL(request.url).search) return Response.json({ error: "Paramètres interdits" }, { status: 400 });
  const cameraId = decodeURIComponent(new URL(request.url).pathname.slice("/api/cameras/".length));
  if (!/^(?:C\d{5,12}|[a-z]+:[A-Z0-9]{1,12})$/.test(cameraId)) return Response.json({ error: "Identifiant invalide" }, { status: 400 });
  const limited = await guardPublicApi(request, "cameras");
  if (limited) return limited;
  const camera = await cameraById(cameraId);
  return camera ? Response.json({ ...camera, providerApiUrl: null }, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Caméra inconnue" }, { status: 404 });
});
