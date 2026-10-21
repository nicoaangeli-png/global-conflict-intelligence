import type { EventEvidence, MatchDecision, MatchReason, OrbitalEvent, Signal } from "@/types/detection";
import { normalized } from "./normalize";
import { canonicalUrl, similarity, tokens } from "./fingerprint";
import { canonicalPlaceKey } from "./lexicon/places";
import { detectContradictions } from "./lexicon/contradictions";
import { MAX_EVIDENCE, MAX_MATCH_EVIDENCE, MAX_MATCH_TEXT_CHARS } from "./limits";

export const WINDOW_MS = 45 * 60_000;
export const MAX_EVENT_SPAN_MS = 6 * 3_600_000;
export const CANDIDATE_WINDOW_MS = MAX_EVENT_SPAN_MS + WINDOW_MS;
export const signalTime = (signal: Signal): number | null => {
  const value = signal.occurredAt ?? signal.publishedAt ?? signal.detectedAt;
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
};
export function distanceKm(first: { lat: number; lon: number }, second: { lat: number; lon: number }): number {
  const radians = Math.PI / 180;
  const value = Math.sin((second.lat - first.lat) * radians / 2) ** 2
    + Math.cos(first.lat * radians) * Math.cos(second.lat * radians) * Math.sin((second.lon - first.lon) * radians / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, value)));
}
export const reliablePosition = (position: Signal["position"]): position is NonNullable<Signal["position"]> =>
  position !== null && ["point", "city"].includes(position.precision) && Number.isFinite(position.lat)
  && Number.isFinite(position.lon) && Math.abs(position.lat) <= 90 && Math.abs(position.lon) <= 180;

const GENERIC = new Set("explosion missile earthquake protest outage attack incident weather thermal riot shelling airstrike bombardement".split(" "));
const continuing = (signal: Signal) => ["protest", "outage", "weather"].includes(signal.kind);
const text = (signal: Signal) => signal.title.slice(0, 500) + " " + (signal.text ?? "").slice(0, MAX_MATCH_TEXT_CHARS - 500);
const majority = (size: number) => Math.floor(size / 2) + 1;

function representatives(items: EventEvidence[], durable: boolean): EventEvidence[] {
  const groups = new Map<string, EventEvidence>();
  for (const item of items) {
    const previous = groups.get(item.independenceGroup);
    const time = signalTime(item.signal) ?? -Infinity;
    const previousTime = previous ? signalTime(previous.signal) ?? -Infinity : -Infinity;
    if (!previous || (durable ? time > previousTime : time < previousTime) || (time === previousTime && item.signal.id < previous.signal.id)) groups.set(item.independenceGroup, item);
  }
  return [...groups.values()].sort((first, second) => first.signal.id.localeCompare(second.signal.id));
}

function temporalCore(items: EventEvidence[], durable: boolean): EventEvidence[] {
  const timed = items.filter((item) => signalTime(item.signal) !== null)
    .sort((first, second) => signalTime(first.signal)! - signalTime(second.signal)! || first.signal.id.localeCompare(second.signal.id));
  let best: EventEvidence[] = [];
  let start = 0;
  for (let end = 0; end < timed.length; end++) {
    if (durable && end > 0 && signalTime(timed[end].signal)! - signalTime(timed[end - 1].signal)! > WINDOW_MS) start = end;
    while (start < end && signalTime(timed[end].signal)! - signalTime(timed[start].signal)! > (durable ? MAX_EVENT_SPAN_MS : WINDOW_MS)) start++;
    if (end - start + 1 > best.length) best = timed.slice(start, end + 1);
  }
  return best;
}

export function matchingAnchor(event: OrbitalEvent): number {
  const items = representatives(event.evidence, event.evidence.some((item) => continuing(item.signal)));
  const core = temporalCore(items, event.evidence.some((item) => continuing(item.signal)));
  const times = (core.length >= majority(items.length) ? core : items)
    .map((item) => signalTime(item.signal) ?? Date.parse(item.signal.receivedAt)).sort((first, second) => first - second);
  return times[Math.floor(times.length / 2)] ?? Date.parse(event.lastReceivedAt);
}

export function consensusPosition(event: OrbitalEvent): Signal["position"] {
  const items = representatives(event.evidence, false).filter((item) => reliablePosition(item.signal.position));
  const ranked = items.map((item) => ({
    position: item.signal.position!, id: item.signal.id,
    distance: items.reduce((sum, other) => sum + distanceKm(item.signal.position!, other.signal.position!), 0),
    neighbors: items.filter((other) => distanceKm(item.signal.position!, other.signal.position!) <= 25).length,
  })).sort((first, second) => second.neighbors - first.neighbors || first.distance - second.distance || first.id.localeCompare(second.id));
  return ranked[0] && ranked[0].neighbors >= majority(items.length) ? ranked[0].position : null;
}

export function matchDecision(signal: Signal, event: OrbitalEvent): MatchDecision {
  let examinedEvidence = 0;
  const positive = new Set<MatchReason>();
  const negative = new Set<MatchReason>();
  const decision = (score: number, ids: string[] = []): MatchDecision => ({
    version: 1, matched: score > 0, score,
    reasons: [...new Set([...positive, ...negative])].sort(),
    positiveFactors: [...positive].sort(), negativeFactors: [...negative].sort(),
    supportingSignalIds: ids.sort(), examinedEvidence,
  });
  const reject = (reason: MatchReason) => { negative.add(reason); return decision(0); };
  if (signal.kind !== event.kind || signal.kind === "other") return reject("rejected_kind");
  const time = signalTime(signal);
  if (time === null) return reject("rejected_time");
  if (event.evidence.length > MAX_EVIDENCE || event.evidence.length > MAX_MATCH_EVIDENCE) return reject("rejected_limit");
  const items = representatives(event.evidence, continuing(signal));
  examinedEvidence = items.length;
  if (!items.length) return reject("rejected_consensus");
  const core = temporalCore(items, continuing(signal));
  if (core.length < majority(items.length)) return reject("rejected_consensus");
  const coreTimes = core.map((item) => signalTime(item.signal)!);
  const span = Math.max(time, ...coreTimes) - Math.min(time, ...coreTimes);
  const allTimes = items.map((item) => signalTime(item.signal)).filter((value): value is number => value !== null);
  const extended = continuing(signal) && Math.max(time, ...allTimes) - Math.min(time, ...allTimes) > WINDOW_MS;
  if (span > (extended ? MAX_EVENT_SPAN_MS : WINDOW_MS)) return reject("rejected_time");
  const recent = core.filter((item) => Math.abs(time - signalTime(item.signal)!) <= WINDOW_MS);
  const required = extended ? Math.max(2, majority(recent.length)) : majority(items.length);
  if (recent.length < required) return reject("rejected_time");
  if (core.length < items.length) { positive.add("ignored_outliers"); negative.add("rejected_time"); }

  const positioned = core.filter((item) => reliablePosition(item.signal.position));
  if (reliablePosition(signal.position) && positioned.length) {
    const near = positioned.filter((item) => distanceKm(signal.position!, item.signal.position!) <= 25);
    if (near.length < majority(positioned.length)) return reject("rejected_distance");
    if (near.length < positioned.length) positive.add("ignored_outliers");
  }

  const incoming = tokens(text(signal));
  const support: { id: string; score: number }[] = [];
  for (const item of recent) {
    const previous = item.signal;
    if (previous.kind !== signal.kind) { negative.add("rejected_kind"); continue; }
    const keyA = canonicalPlaceKey(signal.place);
    const keyB = canonicalPlaceKey(previous.place);
    const samePlace = Boolean(signal.place && previous.place && ((keyA && keyB && keyA === keyB) || normalized(signal.place) === normalized(previous.place)));
    if (signal.place && previous.place && !samePlace) { negative.add("rejected_place"); continue; }
    if (signal.countries.length && previous.countries.length && !signal.countries.some((country) => previous.countries.includes(country))) { negative.add("rejected_country"); continue; }
    const precise = reliablePosition(signal.position) && reliablePosition(previous.position);
    const nearby = precise && distanceKm(signal.position!, previous.position!) <= 25;
    if (precise && !nearby) { negative.add("rejected_distance"); continue; }
    if (!nearby && !samePlace) { negative.add("rejected_place"); continue; }
    const excluded = new Set([...GENERIC, ...tokens((signal.place ?? "") + " " + (previous.place ?? "") + " " + signal.countries.join(" ") + " " + previous.countries.join(" "))]);
    const specific = (value: string) => [...tokens(value)].some((word) => !excluded.has(word));
    const entities = signal.entities.filter(specific).map(normalized);
    const previousEntities = previous.entities.filter(specific).map(normalized);
    const commonEntities = entities.some((entity) => previousEntities.includes(entity));
    if (entities.length && previousEntities.length && !commonEntities) { negative.add("rejected_entities"); continue; }
    const combined = detectContradictions([text(signal), text(previous)]);
    if (combined.some((reason) => reason.startsWith("Nature exacte"))) negative.add("rejected_contradiction");
    const previousTokens = tokens(text(previous));
    const shared = [...incoming].filter((word) => previousTokens.has(word));
    const descriptive = shared.filter((word) => !excluded.has(word));
    const overlap = similarity(incoming, previousTokens);
    const localOverlap = nearby && samePlace ? shared.length / Math.max(1, Math.min(incoming.size, previousTokens.size)) : 0;
    const uncertain = signal.occurredAt === null || previous.occurredAt === null;
    if (uncertain) {
      const sameUrl = canonicalUrl(signal.url) !== null && canonicalUrl(signal.url) === item.canonicalUrl;
      const sameContent = normalized(text(signal)) === normalized(text(previous));
      if ((signal.occurredAt === null) !== (previous.occurredAt === null) || (!sameUrl && !sameContent)) { negative.add("uncertain_occurrence"); continue; }
    }
    const descriptiveMatch = descriptive.length >= 2 || ((commonEntities || samePlace) && descriptive.length >= 1);
    const textualMatch = overlap >= (nearby ? 0.28 : 0.65) || localOverlap >= 0.4 || (nearby && commonEntities && overlap >= 0.18);
    if (!descriptiveMatch || !textualMatch) { negative.add("rejected_content"); continue; }
    support.push({ id: previous.id, score: overlap });
    positive.add("temporal_match"); positive.add("textual_match");
    if (nearby) positive.add("geographic_match");
    if (samePlace) positive.add("place_match");
    if (commonEntities) positive.add("entity_match");
    if (uncertain) positive.add("uncertain_occurrence");
  }
  if (support.length < required) return reject("rejected_consensus");
  if (extended) positive.add("continuing_event");
  if (support.length < items.length) positive.add("ignored_outliers");
  const average = support.reduce((sum, item) => sum + item.score, 0) / support.length;
  const score = Math.min(1, Math.max(0.01, average * 0.5 + 0.2 + (positive.has("geographic_match") ? 0.15 : 0) + (positive.has("entity_match") ? 0.1 : 0) + 0.05 * support.length / items.length - (negative.size ? 0.05 : 0)));
  return decision(score, support.map((item) => item.id));
}

export function match(signal: Signal, event: OrbitalEvent): number {
  return matchDecision(signal, event).score;
}
