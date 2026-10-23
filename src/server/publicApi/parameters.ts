import "server-only";
import { MAX_FILTER_VALUES } from "@/server/filters";

function invalid(): Response {
  return Response.json({ error: "Paramètres de requête invalides ou trop volumineux." }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

/** Borne toutes les entrées avant parsing, y compris les paramètres ignorés par les filtres. */
export function validatePublicQuery(params: URLSearchParams): Response | null {
  if (params.toString().length > 4096 || [...params].length > 40) return invalid();
  for (const [key, value] of params) {
    if (key.length > 64 || value.length > 512) return invalid();
  }
  return null;
}

export function validatePublicFilters(params: URLSearchParams): Response | null {
  const oversized = validatePublicQuery(params);
  if (oversized) return oversized;
  for (const key of ["types", "datasets", "confidences", "countries"]) {
    if ((params.get(key)?.split(",").length ?? 0) > MAX_FILTER_VALUES) return invalid();
  }
  const fatalities = params.get("minFatalities");
  if (fatalities !== null && (!Number.isFinite(Number(fatalities)) || Number(fatalities) < 0 || Number(fatalities) > 10_000_000)) return invalid();
  const at = params.get("at");
  if (at && Number.isNaN(new Date(at).getTime())) return invalid();
  const degrees = params.get("degrees");
  if (degrees !== null && (!Number.isFinite(Number(degrees)) || Number(degrees) < 0.25 || Number(degrees) > 30)) return invalid();
  return null;
}
