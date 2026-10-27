import { instrumentRoute } from "@/server/observability/http";
import { guardPublicApi } from "@/server/publicApi/limits";
import { validatePublicQuery } from "@/server/publicApi/parameters";
import { filterCameras, loadCameras, parseCameraQuery } from "@/server/cameras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = instrumentRoute("/api/cameras", async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const invalid = validatePublicQuery(params);
  if (invalid) return invalid;
  let query: ReturnType<typeof parseCameraQuery>;
  try { query = parseCameraQuery(params); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Paramètres invalides" }, { status: 400 }); }
  const limited = await guardPublicApi(request, "cameras");
  if (limited) return limited;
  const catalog = filterCameras(await loadCameras(fetch, Date.now(), query.provider), query);
  return Response.json(catalog, { status: catalog.status === "error" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
});
