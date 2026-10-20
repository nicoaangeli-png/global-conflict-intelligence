import "server-only";
import type { DetectionResponse, OrbitalEvent, SignalKind } from "@/types/detection";
import { MAX_TOOL_OUTPUT_CHARS } from "../config";
import { cleanText, safeHttpUrl, sanitizeTree } from "../sanitize";
import type { ToolArgs, ToolResult } from "./types";

const KINDS: SignalKind[] = ["explosion", "earthquake", "protest", "outage", "thermal", "incident", "weather", "other"];
const SOURCE = "Moteur de détection ORBITAL";
const DATA_BUDGET = MAX_TOOL_OUTPUT_CHARS - 3_000;
const timestamp = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const validPosition = (position: OrbitalEvent["position"]) => position !== null && position.precision !== "unknown"
  && Number.isFinite(position.lat) && Math.abs(position.lat) <= 90 && Number.isFinite(position.lon) && Math.abs(position.lon) <= 180;

function distanceKm(lat: number, lon: number, position: NonNullable<OrbitalEvent["position"]>) {
  const radians = Math.PI / 180;
  const haversine = Math.sin((position.lat - lat) * radians / 2) ** 2
    + Math.cos(lat * radians) * Math.cos(position.lat * radians) * Math.sin((position.lon - lon) * radians / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
}

function eventDetail(event: OrbitalEvent) {
  const timeline = event.timeline.filter((entry) => timestamp(entry.at) !== null)
    .slice().sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const firstEntry = timeline.find((entry) => entry.type === "first_signal");
  const firstEvidence = firstEntry?.signalId ? event.evidence.find((entry) => entry.signal.id === firstEntry.signalId) : undefined;
  const earliestEvidence = event.evidence.filter((entry) => timestamp(entry.signal.receivedAt) !== null)
    .slice().sort((left, right) => Date.parse(left.signal.receivedAt) - Date.parse(right.signal.receivedAt))[0];
  const firstSource = firstEvidence ?? earliestEvidence;
  const crossings = [75, 90].map((threshold) => {
    const entry = timeline.find((candidate) => candidate.confidenceScore >= threshold);
    return { threshold, observedAt: entry?.at ?? null, confidenceScore: entry?.confidenceScore ?? null };
  });
  const evidence = event.evidence.slice(0, 12).map((entry) => ({
    signalId: entry.signal.id,
    nature: entry.signal.nature,
    kind: entry.signal.kind,
    occurredAt: entry.signal.occurredAt,
    publishedAt: entry.signal.publishedAt,
    receivedAt: entry.signal.receivedAt,
    position: entry.signal.position,
    countries: entry.signal.countries.slice(0, 8),
    confirmsOccurrence: entry.signal.confirmsOccurrence,
    severity: entry.signal.severity,
    metric: entry.signal.metric,
    url: safeHttpUrl(entry.canonicalUrl ?? entry.signal.url),
    sourceUrl: safeHttpUrl(entry.signal.url),
    canonicalUrl: safeHttpUrl(entry.canonicalUrl),
    untrusted_content: {
      provider: entry.signal.provider, sourceName: entry.signal.sourceName,
      title: entry.signal.title, text: cleanText(entry.signal.text, 400),
      caveat: entry.signal.caveat, place: entry.signal.place, upstreamAgency: entry.signal.upstreamAgency,
      domain: entry.domain, fingerprint: entry.fingerprint,
      entities: entry.signal.entities.slice(0, 8).join(" ; "),
      independenceGroup: entry.independenceGroup, dependenceReasons: entry.dependenceReasons.slice(0, 8).join(" ; "),
    },
  }));
  return {
    id: event.id, kind: event.kind, status: event.status,
    firstReceivedAt: event.firstReceivedAt, lastReceivedAt: event.lastReceivedAt, occurredAt: event.occurredAt,
    position: validPosition(event.position) ? event.position : null, countries: event.countries.slice(0, 8),
    confidenceScore: event.confidenceScore, scoreKind: "heuristic_not_calibrated_probability",
    confirmationBasis: event.confidence.confirmationBasis, confidenceVersion: event.confidence.version,
    confidenceFactors: event.confidence.factors.slice(0, 20).map((factor) => ({
      points: factor.points, untrusted_content: { code: factor.code, detail: factor.detail },
    })),
    independentSourceCount: event.independentSourceCount, distinctProviderCount: event.distinctProviderCount,
    evidenceCount: event.evidenceCount, evidence,
    omittedEvidence: Math.max(0, event.evidenceCount - evidence.length),
    evidenceTruncated: event.evidenceTruncated || event.evidence.length > evidence.length,
    firstSource: firstSource ? {
      signalId: firstSource.signal.id, observedAt: firstSource.signal.receivedAt,
      url: safeHttpUrl(firstSource.canonicalUrl ?? firstSource.signal.url),
      untrusted_content: { sourceName: firstSource.signal.sourceName, provider: firstSource.signal.provider, title: firstSource.signal.title },
    } : null,
    firstSourceBasis: firstEvidence ? "first_signal_timeline" : "earliest_retained_receivedAt",
    confidenceCrossings: crossings,
    timeline: timeline.slice(-30), omittedTimelineEntries: event.timeline.length - Math.min(timeline.length, 30),
    omittedFactors: Math.max(0, event.confidence.factors.length - 20),
    omittedContradictions: Math.max(0, event.contradictions.length - 20),
    omittedCaveats: Math.max(0, event.confidence.caveats.length - 20),
    untrusted_content: {
      title: event.title, place: event.place,
      contradictions: event.contradictions.slice(0, 20), caveats: event.confidence.caveats.slice(0, 20),
    },
  };
}

export async function getOrbitalEvents(args: ToolArgs): Promise<ToolResult> {
  const error = (message: string): ToolResult => ({ status: "error", source: SOURCE, data: { error: message } });
  if (Object.keys(args).some((key) => !["eventId", "query", "country", "lat", "lon", "radiusKm", "kind", "limit"].includes(key))) return error("Argument inconnu");
  for (const [key, max] of [["eventId", 160], ["query", 200], ["country", 80]] as const) {
    if (Object.hasOwn(args, key) && (typeof args[key] !== "string" || !args[key].trim() || args[key].length > max)) return error(`${key} doit être une chaîne non vide de ${max} caractères maximum`);
  }
  if (Object.hasOwn(args, "kind") && !KINDS.includes(args.kind as SignalKind)) return error("kind inconnu");
  const limit = args.limit === undefined ? 5 : args.limit;
  if (Object.hasOwn(args, "limit") && args.limit === undefined) return error("limit doit être un entier entre 1 et 10");
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 10) return error("limit doit être un entier entre 1 et 10");
  const nearby = ["lat", "lon", "radiusKm"].some((key) => Object.hasOwn(args, key));
  if (nearby && (typeof args.lat !== "number" || !Number.isFinite(args.lat) || Math.abs(args.lat) > 90
    || typeof args.lon !== "number" || !Number.isFinite(args.lon) || Math.abs(args.lon) > 180
    || (args.radiusKm !== undefined && (typeof args.radiusKm !== "number" || !Number.isFinite(args.radiusKm) || args.radiusKm <= 0 || args.radiusKm > 500)))) {
    return error("Proximité : lat et lon valides obligatoires, radiusKm > 0 et <= 500");
  }
  const { getDetectionSnapshot } = await import("@/server/detection");
  const snapshot: DetectionResponse = await getDetectionSnapshot();
  const events = snapshot.events.slice().sort((left, right) => (timestamp(right.lastReceivedAt) ?? -Infinity) - (timestamp(left.lastReceivedAt) ?? -Infinity)).slice(0, 200);
  const matches = events.filter((event) => {
    if (args.eventId && event.id !== args.eventId) return false;
    if (args.kind && event.kind !== args.kind) return false;
    if (args.country && !event.countries.some((country) => country.toLowerCase() === String(args.country).trim().toLowerCase())) return false;
    if (args.query && ![event.title, event.place, ...event.evidence.flatMap((entry) => [entry.signal.title, entry.signal.text])].join(" ").toLowerCase().includes(String(args.query).trim().toLowerCase())) return false;
    return !nearby || (validPosition(event.position) && distanceKm(args.lat as number, args.lon as number, event.position!) <= (args.radiusKm as number | undefined ?? 100));
  });
  const data = {
    generatedAt: snapshot.generatedAt, snapshotStatus: snapshot.status, searchedEvents: events.length,
    snapshotTruncated: snapshot.events.length > events.length,
    events: [] as ReturnType<typeof eventDetail>[], truncated: false, omittedEvents: 0,
    note: "Score heuristique, pas une probabilité calibrée. firstSource.observedAt et confidenceCrossings.observedAt sont des observations du moteur, jamais des dates historiques du fait. Première source parmi les preuves conservées ; seuil absent = franchissement non observé. Recherche limitée aux 200 événements récents du snapshot, sans réseau.",
  };
  const serializedSize = () => JSON.stringify(sanitizeTree(data, { redacted: 0, truncated: 0 })).length;
  for (const event of matches.slice(0, limit)) {
    const detail = eventDetail(event);
    data.events.push(detail);
    while (serializedSize() > DATA_BUDGET && detail.evidence.length) {
      detail.evidence.pop(); detail.omittedEvidence += 1; detail.evidenceTruncated = true;
    }
    while (serializedSize() > DATA_BUDGET && detail.timeline.length) {
      detail.timeline.shift(); detail.omittedTimelineEntries += 1;
    }
    while (serializedSize() > DATA_BUDGET && detail.confidenceFactors.length) {
      detail.confidenceFactors.pop(); detail.omittedFactors += 1;
    }
    while (serializedSize() > DATA_BUDGET && detail.untrusted_content.contradictions.length) {
      detail.untrusted_content.contradictions.pop(); detail.omittedContradictions += 1;
    }
    while (serializedSize() > DATA_BUDGET && detail.untrusted_content.caveats.length) {
      detail.untrusted_content.caveats.pop(); detail.omittedCaveats += 1;
    }
    if (serializedSize() > DATA_BUDGET) { data.events.pop(); break; }
  }
  data.omittedEvents = matches.length - data.events.length;
  data.truncated = data.omittedEvents > 0;
  return { status: snapshot.status === "unavailable" ? "unavailable" : matches.length ? "ok" : "empty", source: SOURCE, data };
}
