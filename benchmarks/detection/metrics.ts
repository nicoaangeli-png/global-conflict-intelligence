import type { OrbitalEvent } from "@/types/detection";

export type Counts = { tp: number; fp: number; fn: number; tn: number; precision: number | null; recall: number | null; f1: number | null };
export type Pairwise = { togetherCorrect: number; togetherWrong: number; apartCorrect: number; apartWrong: number; precision: number | null; recall: number | null; f1: number | null };

const ratio = (numerator: number, denominator: number): number | null => denominator ? numerator / denominator : null;
const harmonic = (precision: number | null, recall: number | null): number | null =>
  precision === null || recall === null ? null : precision + recall ? 2 * precision * recall / (precision + recall) : 0;

/** Signal-level admission, not real-world conflict discovery or editorial truth. */
export function detectionCounts(truth: ReadonlyMap<string, string | null>, represented: ReadonlySet<string>): Counts {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const [id, group] of truth) {
    if (group !== null && represented.has(id)) tp++;
    else if (group !== null) fn++;
    else if (represented.has(id)) fp++;
    else tn++;
  }
  const precision = ratio(tp, tp + fp), recall = ratio(tp, tp + fn);
  return { tp, fp, fn, tn, precision, recall, f1: harmonic(precision, recall) };
}

/** Every labelled positive pair is scored; a missing signal is not counted as a correct split. */
export function pairwiseCounts(truth: ReadonlyMap<string, string | null>, events: readonly OrbitalEvent[]): Pairwise {
  const assigned = new Map(events.flatMap((event) => event.evidence.map((item) => [item.signal.id, event.id] as const)));
  const positiveIds = [...truth].filter(([, group]) => group !== null).map(([id]) => id);
  let togetherCorrect = 0, togetherWrong = 0, apartCorrect = 0, apartWrong = 0;
  for (let i = 0; i < positiveIds.length; i++) for (let j = i + 1; j < positiveIds.length; j++) {
    const left = positiveIds[i], right = positiveIds[j];
    const shouldTogether = truth.get(left) === truth.get(right);
    const areTogether = assigned.has(left) && assigned.get(left) === assigned.get(right);
    if (shouldTogether && areTogether) togetherCorrect++;
    else if (shouldTogether) apartWrong++;
    else if (areTogether) togetherWrong++;
    else apartCorrect++;
  }
  const precision = ratio(togetherCorrect, togetherCorrect + togetherWrong);
  const recall = ratio(togetherCorrect, togetherCorrect + apartWrong);
  return { togetherCorrect, togetherWrong, apartCorrect, apartWrong, precision, recall, f1: harmonic(precision, recall) };
}

export function percentile(values: readonly number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1))];
}

export function partition(events: readonly OrbitalEvent[]): string[][] {
  return events.map((event) => event.evidence.map((item) => item.signal.id).sort()).sort((a, b) => a.join("|").localeCompare(b.join("|")));
}
