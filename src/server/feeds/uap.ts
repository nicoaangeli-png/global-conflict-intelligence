import type { LiveItem } from "@/types/feeds";
import { FeedError, fetchBytes, fetchText, num, plainText, summaryOrNull, type FeedContext, type FeedSourceDef } from "./util";
import { readFirstSheet } from "./xlsx";

/**
 * Phénomènes aériens non identifiés : on ne publie QUE des rapports émis par des institutions,
 * avec leur classification officielle et un avertissement systématique. Rien n'est présenté comme un fait.
 */

const GEIPAN_LABELS: Record<string, string> = {
  A: "phénomène identifié",
  B: "phénomène probablement identifié",
  C: "non identifiable faute d'informations fiables",
  D: "non identifié après enquête",
};

/** « 26/03/2026 » → date UTC ; null si le jour ou le mois est inconnu (« --/--/1937 »). */
function geipanDate(value: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value ?? "");
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(m[1]) ? null : date.toISOString();
}

export interface GeipanOptions {
  /** Nombre de cas les plus récents conservés (défaut 50). */
  recent?: number;
  /** Les cas D sont tous conservés depuis cette année (défaut : 5 ans avant l'année courante ; les enquêtes D sont longues à publier). */
  dSinceYear?: number;
}

/** Export officiel des cas publiés du GEIPAN (CNES), au format tableur. */
export function parseGeipan(buf: Uint8Array, ctx: FeedContext, options: GeipanOptions = {}): LiveItem[] {
  let rows: Array<Record<string, string>>;
  try {
    rows = readFirstSheet(buf);
  } catch {
    throw new FeedError("GEIPAN : le fichier d'export n'a pas pu être lu (format inattendu).");
  }
  const header = rows[0];
  if (!header || header.F !== "Classification" || header.A !== "ID Etude de Cas") throw new FeedError("GEIPAN : colonnes de l'export différentes de celles attendues.");
  const cases = rows
    .slice(1)
    .filter((row) => row.A && /^[ABCD]$/.test(row.F ?? ""))
    .map((row) => ({ row, occurredAt: geipanDate(row.H) }));
  const dated = cases.filter((c) => c.occurredAt).sort((a, b) => (b.occurredAt as string).localeCompare(a.occurredAt as string));
  const dSinceYear = options.dSinceYear ?? new Date(ctx.fetchedAt).getUTCFullYear() - 5;
  const kept = new Set(dated.slice(0, options.recent ?? 50));
  for (const c of dated) if (c.row.F === "D" && Number(c.occurredAt?.slice(0, 4)) >= dSinceYear) kept.add(c);

  return dated
    .filter((c) => kept.has(c))
    .map(({ row, occurredAt }) => {
      const letter = row.F;
      const label = GEIPAN_LABELS[letter];
      const lat = num(row.N);
      const lon = num(row.O);
      return {
        id: `geipan:${row.A}`,
        category: "uap" as const,
        nature: "published_report" as const,
        title: `Cas GEIPAN ${letter} — ${plainText(row.B)}`,
        summary: summaryOrNull(`Classification GEIPAN ${letter} (${label}). ${plainText(row.E)}`, 420),
        url: `https://www.cnes-geipan.fr/fr/cas/${encodeURIComponent(row.A)}`,
        sourceId: "geipan",
        sourceName: "GEIPAN (CNES, France)",
        publishedAt: null,
        occurredAt,
        fetchedAt: ctx.fetchedAt,
        countries: ["FRA"],
        lat,
        lon,
        severity: null,
        metric: null,
        caveat: `Classification GEIPAN : ${letter} (${label}) — un cas D signifie non expliqué, pas d'origine extraterrestre établie. Témoignage publié après enquête, non un fait établi.`,
      };
    });
}

export const uapSources: FeedSourceDef[] = [
  {
    sourceId: "geipan",
    sourceName: "GEIPAN (CNES, France)",
    category: "uap",
    homepage: "https://www.cnes-geipan.fr",
    license: "Données ouvertes du GEIPAN / CNES (export officiel des cas publiés)",
    ttlMs: 6 * 3_600_000,
    async load(ctx) {
      // L'export officiel (cas publiés) est un classeur d'environ 2 Mo : délai élargi.
      const bytes = await fetchBytes("https://www.cnes-geipan.fr/fr/cnes/export/cas", { timeoutMs: 20_000, maxBytes: 20_000_000 });
      return parseGeipan(bytes, ctx);
    },
  },
  {
    sourceId: "aaro",
    sourceName: "AARO (Pentagone, États-Unis)",
    category: "uap",
    homepage: "https://www.aaro.mil",
    license: null,
    ttlMs: 6 * 3_600_000,
    errorTtlMs: 6 * 3_600_000,
    async load() {
      // Sondage honnête : si le site refuse l'accès automatisé (403), on l'indique sans contournement.
      await fetchText("https://www.aaro.mil/", { accept: "text/html" });
      throw new FeedError("aaro.mil est accessible mais ne propose aucun flux structuré (RSS/JSON) connu : connecteur non réalisé, aucune donnée affichée.");
    },
  },
  {
    sourceId: "nasa-uap",
    sourceName: "NASA — étude sur les PAN/UAP",
    category: "uap",
    homepage: "https://science.nasa.gov/uap/",
    license: "Domaine public (NASA)",
    ttlMs: 6 * 3_600_000,
    async load() {
      return [];
    },
    unavailable: {
      status: "not_configured",
      message: "La page officielle de la NASA est statique (rapport final de l'équipe d'étude indépendante, septembre 2023) : aucun flux daté, donc aucune publication récente à lister.",
    },
  },
];
