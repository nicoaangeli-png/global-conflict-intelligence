import {
  CONFIDENCE_LEVELS,
  EVENT_TYPES,
  REAL_DATASETS,
  TIME_RANGES,
  type Confidence,
  type EventFilters,
  type EventType,
  type TimeRangeKey,
} from "@/types/conflict";

/** Lecture / validation des filtres transmis par l'interface. */
export function filtersFromSearchParams(params: URLSearchParams): EventFilters {
  const list = (key: string): string[] =>
    (params.get(key) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const range = list("range")[0] as TimeRangeKey | undefined;
  const validRange = TIME_RANGES.some((r) => r.key === range) ? (range as TimeRangeKey) : "30d";
  const atRaw = params.get("at");
  const atDate = atRaw ? new Date(atRaw) : null;

  return {
    range: validRange,
    types: list("types").filter((t): t is EventType => (EVENT_TYPES as readonly string[]).includes(t)),
    datasets: params.has("datasets") ? list("datasets") : [...REAL_DATASETS],
    confidences: list("confidences").filter((c): c is Confidence =>
      (CONFIDENCE_LEVELS as readonly string[]).includes(c),
    ),
    countries: list("countries"),
    minFatalities: Math.max(0, Number(params.get("minFatalities") ?? 0) || 0),
    at: atDate && !Number.isNaN(atDate.getTime()) ? atDate.toISOString() : null,
  };
}

/** Bornes de la fenêtre temporelle (curseur `at` inclus). */
export function windowFor(filters: { range: TimeRangeKey; at: string | null }, now = Date.now()) {
  const days = TIME_RANGES.find((r) => r.key === filters.range)?.days ?? 30;
  const to = filters.at ? new Date(filters.at) : new Date(now);
  const from = new Date(to.getTime() - days * 86400e3);
  return { from, to, days };
}

/** Rayon d'agrégation demandé par le client (borné). */
export function degreesFromSearchParams(params: URLSearchParams): number {
  const raw = Number(params.get("degrees") ?? 2.4);
  if (!Number.isFinite(raw)) return 2.4;
  return Math.min(30, Math.max(0.25, raw));
}
