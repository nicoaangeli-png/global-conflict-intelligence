import { instrumentRoute } from "@/server/observability/http";
import { guardPublicApi } from "@/server/publicApi/limits";
import { cameraFrame } from "@/server/cameras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = instrumentRoute("/api/cameras/frame", async (request: Request) => {
  const search = new URL(request.url).searchParams;
  if ([...search.keys()].some((key) => key !== "v") || search.getAll("v").length > 1 || (search.has("v") && !/^\d{1,13}$/.test(search.get("v") ?? ""))) return Response.json({ error: "Paramètres interdits" }, { status: 400 });
  const cameraId = decodeURIComponent(new URL(request.url).pathname.slice("/api/cameras/".length, -"/frame".length));
  if (!/^(?:C\d{5,12}|[a-z]+:[A-Z0-9]{1,12})$/.test(cameraId)) return Response.json({ error: "Identifiant invalide" }, { status: 400 });
  const limited = await guardPublicApi(request, "camera-frame");
  if (limited) return limited;
  try {
    const frame = await cameraFrame(cameraId);
    return frame ? new Response(Buffer.from(frame.bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": `public, max-age=${frame.cacheSeconds}`, "X-Content-Type-Options": "nosniff" } }) : Response.json({ error: "Image indisponible" }, { status: 404 });
  } catch { return Response.json({ error: "Image caméra indisponible" }, { status: 502, headers: { "Cache-Control": "no-store" } }); }
});
