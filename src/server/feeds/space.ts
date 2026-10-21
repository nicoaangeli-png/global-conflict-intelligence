import type { LiveItem } from "@/types/feeds";
import { canonicalIso3 } from "./countries";
import { FeedError, fetchJson, num, plainText, sleep, summaryOrNull, toIso, type FeedContext, type FeedSourceDef } from "./util";

interface Ll2Launch {
  id?: string;
  name?: string;
  status?: { name?: string; abbrev?: string };
  net?: string;
  last_updated?: string;
  launch_service_provider?: { name?: string };
  rocket?: { configuration?: { full_name?: string; name?: string } };
  mission?: { name?: string; description?: string; type?: string; orbit?: { name?: string } } | null;
  pad?: { name?: string; latitude?: string | number; longitude?: string | number; location?: { name?: string; country_code?: string } };
  webcast_live?: boolean;
}

/** Lancements Launch Library 2 (mode « normal », qui porte le pays du site de lancement). */
export function parseLl2(raw: unknown, ctx: FeedContext, kind: "upcoming" | "previous"): LiveItem[] {
  const results = (raw as { results?: Ll2Launch[] } | null)?.results;
  if (!Array.isArray(results)) throw new FeedError("Launch Library 2 : format de réponse inattendu.");
  const items: LiveItem[] = [];
  for (const launch of results) {
    if (!launch.id || !launch.name) continue;
    const lat = num(launch.pad?.latitude);
    const lon = num(launch.pad?.longitude);
    const country = canonicalIso3(launch.pad?.location?.country_code ?? "");
    const rocket = launch.rocket?.configuration?.full_name ?? launch.rocket?.configuration?.name;
    const facts = [
      launch.status?.name ? `Statut : ${launch.status.name}` : "",
      launch.launch_service_provider?.name ? `Opérateur : ${launch.launch_service_provider.name}` : "",
      rocket ? `Lanceur : ${rocket}` : "",
      launch.pad?.location?.name ? `Site : ${launch.pad.location.name}` : "",
      launch.mission?.orbit?.name ? `Orbite : ${launch.mission.orbit.name}` : "",
    ].filter(Boolean);
    const description = plainText(launch.mission?.description);
    items.push({
      id: `ll2:${launch.id}`,
      category: "space",
      nature: "scheduled_event",
      title: plainText(launch.name),
      summary: summaryOrNull(`${facts.join(". ")}.${description ? ` ${description}` : ""}`, 450),
      url: `https://ll.thespacedevs.com/2.2.0/launch/${launch.id}/`,
      sourceId: "ll2",
      sourceName: "Launch Library 2 (The Space Devs)",
      publishedAt: toIso(launch.last_updated),
      occurredAt: toIso(launch.net),
      fetchedAt: ctx.fetchedAt,
      countries: country ? [country] : [],
      lat,
      lon,
      severity: null,
      metric: null,
      caveat:
        kind === "upcoming"
          ? "Date prévue (NET, « pas avant »), susceptible d'être repoussée ; le pays est celui du site de lancement."
          : "Lancement passé : vérifier le résultat sur la page de la source ; le pays est celui du site de lancement.",
    });
  }
  return items;
}

export const spaceSources: FeedSourceDef[] = [
  {
    sourceId: "ll2",
    sourceName: "Launch Library 2 (The Space Devs)",
    category: "space",
    homepage: "https://thespacedevs.com/llapi",
    license: "Données The Space Devs (CC BY 4.0), quota anonyme de 15 requêtes par heure",
    quota: "15 requêtes par heure (accès anonyme)",
    // Quota anonyme : 2 requêtes par rafraîchissement, donc au plus 2 requêtes par heure en régime normal.
    ttlMs: 65 * 60_000,
    errorTtlMs: 20 * 60_000,
    async load(ctx) {
      const base = "https://ll.thespacedevs.com/2.2.0/launch";
      const upcoming = parseLl2(await fetchJson(`${base}/upcoming/?limit=15&hide_recent_previous=true`), ctx, "upcoming");
      let previous: LiveItem[] = [];
      try {
        await sleep(1000);
        previous = parseLl2(await fetchJson(`${base}/previous/?limit=15`), ctx, "previous");
      } catch {
        // Les lancements passés sont un complément : leur absence ne doit pas masquer les lancements à venir.
      }
      return [...upcoming, ...previous];
    },
  },
];

