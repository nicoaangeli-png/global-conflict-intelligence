import { NextResponse } from "next/server";
import { queryClusters } from "@/server/intel";
import { degreesFromSearchParams, filtersFromSearchParams } from "@/server/filters";

/**
 * Identifiants d'événements envoyés par foyer : un échantillon suffit au client (il ne
 * s'en sert que pour retrouver le foyer sélectionné quand la grille change au zoom ; le
 * détail est recalculé côté serveur).
 */
const CLIENT_EVENT_ID_SAMPLE = 24;

/**
 * Échantillon déterministe réparti sur toute la liste (premier, dernier et intervalles
 * réguliers) : la sélection survit au changement de grille par recouvrement d'identifiants,
 * y compris quand le foyer contient des milliers d'événements.
 */
function sampleEventIds(ids: string[], limit: number): string[] {
  if (ids.length <= limit) return ids;
  const step = (ids.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => ids[Math.round(index * step)]);
}


/**
 * GET /api/events
 * Renvoie les foyers AGRÉGÉS (jamais les événements bruts) pour la période
 * et les filtres demandés. `degrees` contrôle le rayon de regroupement en
 * fonction du niveau de zoom de la caméra.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filters = filtersFromSearchParams(searchParams);
  const degrees = degreesFromSearchParams(searchParams);

  try {
    const data = await queryClusters(filters, degrees);
    const clusters = data.clusters.map((cluster) => (cluster.eventIds.length > CLIENT_EVENT_ID_SAMPLE ? { ...cluster, eventIds: sampleEventIds(cluster.eventIds, CLIENT_EVENT_ID_SAMPLE) } : cluster));
    return NextResponse.json({ ...data, clusters }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Données temporairement indisponibles." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
