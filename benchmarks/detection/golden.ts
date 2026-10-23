import type { Signal, SignalKind } from "@/types/detection";

/** Synthetic, hand-labelled cases: no claim that these describe real-world events. */
export const DATASET_VERSION = "1.0.0";
export const BENCHMARK_NOW = Date.parse("2026-10-22T12:00:00Z");
const iso = (offsetMinutes: number) => new Date(BENCHMARK_NOW + offsetMinutes * 60_000).toISOString();

type Case = {
  id: string;
  truth: string | null;
  rationale: string;
  signal: Signal;
};

function signal(id: string, title: string, options: {
  kind?: SignalKind;
  provider?: string;
  minutes?: number;
  place?: string | null;
  position?: Signal["position"];
  countries?: string[];
  agency?: string | null;
  occurredAt?: string | null;
  publishedAt?: string | null;
  text?: string | null;
} = {}): Signal {
  const place = options.place === undefined ? "Odessa" : options.place;
  return {
    id, title, text: options.text ?? null, kind: options.kind ?? "explosion",
    provider: options.provider ?? id, sourceName: `Synthetic ${options.provider ?? id}`,
    url: `https://${options.provider ?? id}.example/benchmark/${id}`,
    nature: "press", occurredAt: options.occurredAt === undefined ? iso(options.minutes ?? 0) : options.occurredAt,
    publishedAt: options.publishedAt ?? null, receivedAt: iso(0),
    position: options.position === undefined ? { lat: 46.48, lon: 30.73, precision: "city" } : options.position,
    place, countries: options.countries ?? ["UKR"], entities: [], upstreamAgency: options.agency ?? null,
    confirmsOccurrence: false, severity: null, metric: null,
    caveat: "Fixture synthétique ; vérité terrain humaine du benchmark uniquement",
  };
}

export const GOLDEN_CASES: readonly Case[] = [
  { id: "port-en", truth: "odessa-port-1", rationale: "premier récit d'une explosion au terminal portuaire", signal: signal("port-en", "Explosion reported at Odessa Neptune port terminal; nearby windows damaged") },
  { id: "port-fr", truth: "odessa-port-1", rationale: "deuxième source, français, même incident", signal: signal("port-fr", "Explosion au terminal Neptune du port d'Odessa, vitres endommagées", { provider: "french-press", minutes: 4, place: "Odesa" }) },
  { id: "port-en-2", truth: "odessa-port-1", rationale: "troisième source, autre formulation", signal: signal("port-en-2", "Odessa port Neptune terminal explosion damaged windows, officials inspecting site", { minutes: 8 }) },
  { id: "port-wire-copy", truth: "odessa-port-1", rationale: "republication de dépêche : même événement, pas indépendance éditoriale", signal: signal("port-wire-copy", "Explosion reported at Odessa Neptune port terminal; nearby windows damaged", { provider: "wire-mirror", agency: "reuters", minutes: 2 }) },
  { id: "port-wire-copy-2", truth: "odessa-port-1", rationale: "seconde republication de la même agence", signal: signal("port-wire-copy-2", "Explosion reported at Odessa Neptune port terminal; nearby windows damaged", { provider: "second-mirror", agency: "reuters", minutes: 3 }) },
  { id: "port-later", truth: "odessa-port-2", rationale: "autre explosion au même port trois heures plus tard", signal: signal("port-later", "New explosion reported at Odessa Neptune port terminal; nearby windows damaged", { minutes: 180 }) },
  { id: "kharkiv-port", truth: "kharkiv-1", rationale: "même nature et même formulation mais autre ville", signal: signal("kharkiv-port", "Explosion reported at Kharkiv Neptune port terminal; nearby windows damaged", { minutes: 5, place: "Kharkiv", position: { lat: 49.99, lon: 36.23, precision: "city" } }) },
  { id: "tokyo-quake-en", truth: "tokyo-quake", rationale: "séisme de Tokyo, catégorie et lieu distincts", signal: signal("tokyo-quake-en", "Earthquake shakes Tokyo near the eastern station, preliminary magnitude 5.8", { kind: "earthquake", place: "Tokyo", countries: ["JPN"], position: { lat: 35.68, lon: 139.76, precision: "city" } }) },
  { id: "tokyo-quake-fr", truth: "tokyo-quake", rationale: "séisme de Tokyo décrit en français", signal: signal("tokyo-quake-fr", "Séisme à Tokyo près de la gare orientale, magnitude préliminaire 5,8", { kind: "earthquake", place: "Tokyo", countries: ["JPN"], position: { lat: 35.68, lon: 139.76, precision: "city" }, minutes: 3 }) },
  { id: "odessa-outage-en", truth: "odessa-outage", rationale: "panne électrique dans la même ville mais autre catégorie", signal: signal("odessa-outage-en", "Power outage across Odessa northern grid after transformer failure", { kind: "outage", minutes: 10 }) },
  { id: "odessa-outage-fr", truth: "odessa-outage", rationale: "panne et cause corroborées en français", signal: signal("odessa-outage-fr", "Panne électrique sur le réseau nord d'Odessa après défaillance d'un transformateur", { kind: "outage", minutes: 12 }) },
  { id: "kyiv-protest", truth: "kyiv-protest", rationale: "manifestation simultanée dans une autre ville", signal: signal("kyiv-protest", "Protesters gather in Kyiv central square over local transport cuts", { kind: "protest", place: "Kyiv", countries: ["UKR"], position: { lat: 50.45, lon: 30.52, precision: "city" } }) },
  { id: "empty-title", truth: null, rationale: "signal incomplet rejetable syntaxiquement", signal: signal("empty-title", "") },
  { id: "stale-report", truth: null, rationale: "ancien fait hors rétention", signal: signal("stale-report", "Explosion reported at Odessa Neptune port terminal", { occurredAt: iso(-8 * 24 * 60) }) },
  { id: "generic-analysis", truth: null, rationale: "analyse géopolitique générale sans fait daté", signal: signal("generic-analysis", "Regional security analysis of Odessa port and possible future explosions", { occurredAt: null, publishedAt: iso(0) }) },
  { id: "past-attack", truth: null, rationale: "commentaire sur une attaque passée, pas un nouvel événement", signal: signal("past-attack", "Officials recall the Odessa port explosion from last year in retrospective briefing", { occurredAt: null, publishedAt: iso(0) }) },
  { id: "vague-comment", truth: null, rationale: "commentaire vague sans incident concret", signal: signal("vague-comment", "Analysts debate whether future incidents might affect the wider region", { occurredAt: null, publishedAt: iso(0), place: null, position: null, countries: [] }) },
  { id: "misgeolocated", truth: null, rationale: "titre et pays Tokyo mais coordonnées d'Odessa : géolocalisation contradictoire", signal: signal("misgeolocated", "Explosion reported near Tokyo eastern station, windows damaged", { place: "Tokyo", countries: ["JPN"], position: { lat: 46.48, lon: 30.73, precision: "city" } }) },
];

export const EXPECTED_EVENTS = {
  "odessa-port-1": { kind: "explosion", place: "Odessa", country: "UKR" },
  "odessa-port-2": { kind: "explosion", place: "Odessa", country: "UKR" },
  "kharkiv-1": { kind: "explosion", place: "Kharkiv", country: "UKR" },
  "tokyo-quake": { kind: "earthquake", place: "Tokyo", country: "JPN" },
  "odessa-outage": { kind: "outage", place: "Odessa", country: "UKR" },
  "kyiv-protest": { kind: "protest", place: "Kyiv", country: "UKR" },
} as const;

export const GOLDEN_REVISIONS = [
  { id: "port-en", title: "Explosion reported at Odessa Neptune port terminal; windows damaged, casualty estimate revised", expected: "same" },
  { id: "port-later", title: "Earthquake near Tokyo eastern station, corrected location and cause", kind: "earthquake" as const, place: "Tokyo", countries: ["JPN"], position: { lat: 35.68, lon: 139.76, precision: "city" as const }, expected: "new" },
] as const;

export function saturationSignals(count: number): Signal[] {
  return Array.from({ length: count }, (_, index) => signal(`saturation-${index}`, "Explosion at Odessa Neptune port terminal; nearby windows damaged", { provider: `sat-${index}` }));
}
