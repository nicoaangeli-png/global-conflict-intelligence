import type { OrbitalEvent, Signal } from "@/types/detection";
import { normalized } from "./normalize";
import { similarity, tokens } from "./fingerprint";
import { canonicalPlaceKey, extractPlaces } from "./lexicon/places";

export const WINDOW_MS = 45 * 60_000;
export const signalTime = (signal: Signal): number | null => {
  const value = signal.occurredAt ?? signal.publishedAt ?? signal.detectedAt;
  return value ? Date.parse(value) : null;
};
export function distanceKm(first: { lat: number; lon: number }, second: { lat: number; lon: number }): number {
  const radians = Math.PI / 180;
  const value =
    Math.sin(((second.lat - first.lat) * radians) / 2) ** 2 +
    Math.cos(first.lat * radians) * Math.cos(second.lat * radians) * Math.sin(((second.lon - first.lon) * radians) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, value)));
}
export const reliablePosition = (position: Signal["position"]) =>
  position !== null && ["point", "city"].includes(position.precision);

export function match(signal: Signal, event: OrbitalEvent): number {
  if (signal.kind !== event.kind || signal.kind === "other") return 0;
  const time = signalTime(signal);
  if (time === null) return 0;
  const incoming = tokens(`${signal.title} ${signal.text ?? ""}`);
  let best = 0;
  for (const item of event.evidence) {
    const previous = item.signal;
    const previousTime = signalTime(previous);
    if (previousTime === null || Math.abs(time - previousTime) > WINDOW_MS) return 0;
    const precise = reliablePosition(signal.position) && reliablePosition(previous.position);
    const nearby = precise && distanceKm(signal.position!, previous.position!) <= 25;
    if (precise && !nearby) return 0;

    const keyA = canonicalPlaceKey(signal.place);
    const keyB = canonicalPlaceKey(previous.place);
    const samePlace = Boolean(
      (signal.place && previous.place && normalized(signal.place) === normalized(previous.place)) ||
      (keyA && keyB && keyA === keyB)
    );

    const previousTokens = tokens(`${previous.title} ${previous.text ?? ""}`);
    const overlap = similarity(incoming, previousTokens);
    const commonEntities = signal.entities.some((entity) =>
      previous.entities.some((other) => normalized(entity) === normalized(other))
    );
    const shared = [...incoming].filter((word) => previousTokens.has(word));
    const localOverlap =
      nearby && samePlace && Math.min(incoming.size, previousTokens.size) > 0
        ? shared.length / Math.min(incoming.size, previousTokens.size)
        : 0;
    const descriptive = shared.filter((word) => !["explosion", "earthquake", "missile", "protest", "outage"].includes(word));

    const placeNorm = signal.place ? normalized(signal.place) : null;
    const hasPlaceInText = Boolean(placeNorm && incoming.has(placeNorm) && previousTokens.has(placeNorm));
    const signalPlaces = extractPlaces(`${signal.title} ${signal.text ?? ""}`);
    const previousPlaces = extractPlaces(`${previous.title} ${previous.text ?? ""}`);
    const hasExtractedPlace = signalPlaces.some((p) => previousPlaces.includes(p) && incoming.has(p) && previousTokens.has(p));

    if ((nearby || samePlace) && (overlap >= 0.28 || localOverlap >= 0.4 || (commonEntities && overlap >= 0.18))) {
      best = Math.max(best, overlap + 0.5);
    } else if (
      !precise &&
      overlap >= 0.65 &&
      descriptive.length >= 2 &&
      (hasPlaceInText || hasExtractedPlace || commonEntities)
    ) {
      best = Math.max(best, overlap);
    }
  }
  return best;
}
