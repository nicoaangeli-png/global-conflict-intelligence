import type { DetectionResponse, OrbitalEvent, Signal } from "@/types/detection";
import { match, signalTime, WINDOW_MS } from "./cluster";
import { confidence, contradictions } from "./confidence";
import { evidence, hash, independence } from "./fingerprint";
import { importance, isLive } from "./importance";
import { RETENTION_MS, type DetectionStore } from "./store";

export const MAX_EVIDENCE = 128;
export const MAX_TIMELINE = 512;
export function assess(event: OrbitalEvent, now: number): OrbitalEvent {
  event.evidence = independence(event.evidence);
  event.contradictions = contradictions(event.evidence);
  event.independentSourceCount = new Set(event.evidence.map((item) => item.independenceGroup)).size;
  event.distinctProviderCount = new Set(event.evidence.map((item) => item.signal.provider)).size;
  event.evidenceCount = event.evidence.length;
  event.confidence = confidence(event.evidence, now, event.contradictions, event.evidenceTruncated);
  event.confidenceScore = event.confidence.score;
  event.status = event.confidence.status;
  const priority = importance(event);
  event.importanceScore = priority.score;
  event.importanceReasons = priority.reasons;
  event.occurredAt = event.evidence.map((item) => item.signal.occurredAt).filter((value): value is string => value !== null).sort()[0] ?? null;
  event.position = event.evidence.map((item) => item.signal.position).find((position) => position && ["point", "city"].includes(position.precision)) ?? event.evidence[0]?.signal.position ?? null;
  event.countries = [...new Set(event.evidence.flatMap((item) => item.signal.countries))];
  return event;
}

function timeline(event: OrbitalEvent, now: number, type: OrbitalEvent["timeline"][number]["type"], signalId: string | null) {
  if (event.timeline.length >= MAX_TIMELINE) { event.evidenceTruncated = true; return; }
  event.timeline.push({ at: new Date(now).toISOString(), type, signalId, confidenceScore: event.confidenceScore, status: event.status, independentSourceCount: event.independentSourceCount });
}

const anchor = (event: OrbitalEvent) => Math.min(...event.evidence.map((item) => signalTime(item.signal) ?? Date.parse(item.signal.receivedAt)));

export class DetectionEngine {
  constructor(private store: DetectionStore) {}

  ingest(signals: Signal[], now = Date.now()): { accepted: number; skipped: number } {
    if (signals.length > 500) throw new Error("Detection batch exceeds 500 signals");
    return this.store.transaction((transaction) => {
      transaction.purge(now - RETENTION_MS);
      let accepted = 0;
      let skipped = 0;
      for (const signal of signals) {
        const time = signalTime(signal);
        if (!signal.id || !signal.title || !signal.provider || !Number.isFinite(Date.parse(signal.receivedAt)) || (time !== null && (!Number.isFinite(time) || time < now - RETENTION_MS || time > now + 5 * 60_000))) { skipped++; continue; }
        const digest = hash(JSON.stringify({ ...signal, receivedAt: undefined }));
        const previous = transaction.bySignal(signal.id);
        if (previous?.digest === digest) { skipped++; continue; }
        let event = previous?.event;
        if (!event && time !== null) {
          event = transaction.candidates(signal.kind, time, WINDOW_MS)
            .map((candidate) => ({ candidate, score: match(signal, candidate) }))
            .filter((candidate) => candidate.score > 0)
            .sort((first, second) => second.score - first.score || first.candidate.id.localeCompare(second.candidate.id))[0]?.candidate;
        }
        const first = !event;
        if (!event) {
          event = { id: `orbital:${hash(signal.id)}`, title: signal.title, kind: signal.kind,
            firstReceivedAt: new Date(now).toISOString(), lastReceivedAt: new Date(now).toISOString(), occurredAt: null, position: signal.position,
            place: signal.place, countries: signal.countries, evidence: [], confidenceScore: 0, confidence: { score: 0, status: "signal", factors: [], confirmationBasis: null, caveats: [], version: 1 },
            importanceScore: 0, importanceReasons: [], status: "signal", independentSourceCount: 0, distinctProviderCount: 0, evidenceCount: 0, contradictions: [], timeline: [], evidenceTruncated: false };
        }
        const at = event.evidence.findIndex((item) => item.signal.id === signal.id);
        const oldScore = event.confidenceScore;
        const oldStatus = event.status;
        if (at >= 0) event.evidence[at] = evidence(signal);
        else if (event.evidence.length < MAX_EVIDENCE) event.evidence.push(evidence(signal));
        else { event.evidenceTruncated = true; }
        if (event.timeline.length >= MAX_TIMELINE) event.evidenceTruncated = true;
        event.lastReceivedAt = new Date(now).toISOString();
        assess(event, now);
        timeline(event, now, first ? "first_signal" : previous ? "evidence_updated" : "evidence_added", signal.id);
        if (!first && (oldScore !== event.confidenceScore || oldStatus !== event.status)) timeline(event, now, "assessment_changed", null);
        transaction.put(event, anchor(event));
        transaction.remember(signal.id, event.id, digest);
        accepted++;
      }
      return { accepted, skipped };
    });
  }

  snapshot(now = Date.now()): DetectionResponse {
    return this.store.transaction((transaction) => {
      transaction.purge(now - RETENTION_MS);
      const events = transaction.recent(200).map((event) => {
        const oldScore = event.confidenceScore;
        const oldStatus = event.status;
        assess(event, now);
        if (oldScore !== event.confidenceScore || oldStatus !== event.status) {
          timeline(event, now, "assessment_changed", null);
          transaction.put(event, anchor(event));
        }
        return event;
      });
      return { generatedAt: new Date(now).toISOString(), events, live: events.filter((event) => isLive(event, now)).sort((first, second) => second.importanceScore - first.importanceScore || second.confidenceScore - first.confidenceScore).slice(0, 12), status: "ok" };
    });
  }
}
