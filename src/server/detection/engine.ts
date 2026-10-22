import type { DetectionResponse, MatchDecision, OrbitalEvent, Signal } from "@/types/detection";
import { CANDIDATE_WINDOW_MS, consensusPosition, matchDecision, matchingAnchor, signalTime } from "./cluster";
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
  event.position = consensusPosition(event) ?? (event.evidence.every((item) => !item.signal.position || !["point", "city"].includes(item.signal.position.precision)) ? event.evidence[0]?.signal.position ?? null : null);
  event.countries = [...new Set(event.evidence.flatMap((item) => item.signal.countries))];
  return event;
}

function timeline(event: OrbitalEvent, now: number, type: OrbitalEvent["timeline"][number]["type"], signalId: string | null) {
  if (event.timeline.length >= MAX_TIMELINE) { event.evidenceTruncated = true; return; }
  event.timeline.push({ at: new Date(now).toISOString(), type, signalId, confidenceScore: event.confidenceScore, status: event.status, independentSourceCount: event.independentSourceCount });
}

const anchor = matchingAnchor;

function valid(signal: Signal, now: number): boolean {
  const time = signalTime(signal);
  return Boolean(signal.id && signal.title && signal.provider)
    && Number.isFinite(Date.parse(signal.receivedAt))
    && ![signal.occurredAt, signal.publishedAt, signal.detectedAt].some((value) => value != null && !Number.isFinite(Date.parse(value)))
    && (time === null || (time >= now - RETENTION_MS && time <= now + 5 * 60_000));
}

function rebuildIdentity(event: OrbitalEvent): void {
  const representative = [...event.evidence]
    .sort((first, second) => {
      const firstTime = signalTime(first.signal) ?? Date.parse(first.signal.receivedAt);
      const secondTime = signalTime(second.signal) ?? Date.parse(second.signal.receivedAt);
      return firstTime - secondTime || first.signal.id.localeCompare(second.signal.id);
    })[0]?.signal;
  if (!representative) return;
  event.title = representative.title;
  event.kind = representative.kind;
  event.place = representative.place;
}

function freshEvent(id: string, signal: Signal, now: number, previous: OrbitalEvent | null): OrbitalEvent {
  return {
    id, title: signal.title, kind: signal.kind,
    firstReceivedAt: previous?.firstReceivedAt ?? new Date(now).toISOString(), lastReceivedAt: new Date(now).toISOString(), occurredAt: null, position: signal.position,
    place: signal.place, countries: signal.countries, evidence: [], confidenceScore: 0,
    confidence: { score: 0, status: "signal", factors: [], confirmationBasis: null, caveats: [], version: 1 },
    importanceScore: 0, importanceReasons: [], status: "signal", independentSourceCount: 0,
    distinctProviderCount: 0, evidenceCount: 0, contradictions: [], timeline: previous ? [...previous.timeline] : [], evidenceTruncated: false,
  };
}

export class DetectionEngine {
  constructor(private store: DetectionStore) {}

  async ingest(signals: Signal[], now = Date.now()): Promise<{ accepted: number; skipped: number }> {
    if (signals.length > 500) throw new Error("Detection batch exceeds 500 signals");
    // La rétention écrit potentiellement plusieurs catégories. Une transaction courte
    // dédiée évite de conserver ses verrous de lignes pendant le protocole métier
    // signal → catégories → événements.
    await this.store.transaction((transaction) => transaction.purge(now - RETENTION_MS));
    return this.store.transaction(async (transaction) => {
      const acceptedInputs = signals.filter((signal) => valid(signal, now));
      // Ordre global : identifiants de signaux, puis catégories. Le premier verrou
      // stabilise bySignal afin de découvrir sans course l'ancienne catégorie d'une
      // révision ; le second protège à la fois l'ancien et le nouveau cluster.
      await transaction.lockSignals(acceptedInputs.map((signal) => signal.id));
      const previousKinds: Signal["kind"][] = [];
      for (const id of [...new Set(acceptedInputs.map((signal) => signal.id))]) {
        const previous = await transaction.bySignal(id);
        if (previous) {
          previousKinds.push(previous.event.kind);
          previousKinds.push(...previous.event.evidence.map((item) => item.signal.kind));
        }
      }
      await transaction.lock([...new Set([...acceptedInputs.map((signal) => signal.kind), ...previousKinds])].sort());
      let accepted = 0;
      let skipped = 0;
      for (const signal of signals) {
        const time = signalTime(signal);
        if (!valid(signal, now)) { skipped++; continue; }
        const digest = hash(JSON.stringify({ ...signal, receivedAt: undefined }));
        const previous = await transaction.bySignal(signal.id);
        if (previous?.digest === digest) { skipped++; continue; }
        let reusableEventId: string | null = null;
        if (previous) {
          const oldEvent = previous.event;
          const compatibleRevision = matchDecision(signal, oldEvent).matched;
          const at = oldEvent.evidence.findIndex((item) => item.signal.id === signal.id);
          if (at < 0) throw new Error(`Detection integrity error: signal ${signal.id} is mapped to event ${oldEvent.id} but absent from its evidence`);
          oldEvent.evidence.splice(at, 1);
          if (!oldEvent.evidence.length) {
            const mappings = await transaction.signalCountForEvent(oldEvent.id);
            if (mappings !== 1) throw new Error(`Detection integrity error: event ${oldEvent.id} has no evidence after revision but still has ${mappings} signal mappings`);
            if (compatibleRevision) reusableEventId = oldEvent.id;
            await transaction.removeEvent(oldEvent.id);
          } else {
            const oldScore = oldEvent.confidenceScore;
            const oldStatus = oldEvent.status;
            rebuildIdentity(oldEvent);
            oldEvent.lastReceivedAt = new Date(now).toISOString();
            assess(oldEvent, now);
            timeline(oldEvent, now, "evidence_removed", signal.id);
            if (oldScore !== oldEvent.confidenceScore || oldStatus !== oldEvent.status) timeline(oldEvent, now, "assessment_changed", null);
            if (!await transaction.updateEvent(oldEvent, anchor(oldEvent))) {
              throw new Error(`Detection integrity error: event ${oldEvent.id} disappeared during revision`);
            }
            await transaction.forget(signal.id);
          }
        }
        let event: OrbitalEvent | undefined;
        let matching: MatchDecision | undefined;
        if (time !== null) {
          const candidates = await transaction.candidates(signal.kind, time, CANDIDATE_WINDOW_MS);
          const ranked = candidates
            .map((candidate) => ({ candidate, decision: matchDecision(signal, candidate) }))
            .filter((candidate) => candidate.decision.matched)
            .sort((first, second) => second.decision.score - first.decision.score || first.candidate.id.localeCompare(second.candidate.id));
          if (ranked[0] && ranked[1] && ranked[0].decision.score - ranked[1].decision.score <= 0.05) {
            matching = { version: 1, matched: false, score: 0, reasons: ["rejected_ambiguous"], positiveFactors: [], negativeFactors: ["rejected_ambiguous"], supportingSignalIds: [], examinedEvidence: ranked[0].decision.examinedEvidence };
          } else if (ranked[0]) {
            event = ranked[0].candidate;
            matching = ranked[0].decision;
          }
        }
        let first = !event;
        const creationSeed = previous ? `${signal.id}:${digest}:${previous.event.id}` : signal.id;
        const inherited = reusableEventId && previous ? previous.event : null;
        if (!event) event = freshEvent(reusableEventId ?? `orbital:${hash(creationSeed)}`, signal, now, inherited);

        const attach = (target: OrbitalEvent, isFirst: boolean, decision: MatchDecision | undefined): boolean => {
          if (target.evidence.some((item) => item.signal.id === signal.id)) {
            throw new Error(`Detection integrity error: signal ${signal.id} already exists in event ${target.id} without its mapping`);
          }
          const oldScore = target.confidenceScore;
          const oldStatus = target.status;
          if (target.evidence.length >= MAX_EVIDENCE) {
            target.evidenceTruncated = true;
            assess(target, now);
            if (oldScore !== target.confidenceScore || oldStatus !== target.status) timeline(target, now, "assessment_changed", null);
            return false;
          }
          target.evidence.push({ ...evidence(signal), ...(decision ? { matching: decision } : {}) });
          if (target.timeline.length >= MAX_TIMELINE) target.evidenceTruncated = true;
          target.lastReceivedAt = new Date(now).toISOString();
          assess(target, now);
          timeline(target, now, previous && (!isFirst || reusableEventId) ? "evidence_updated" : isFirst ? "first_signal" : "evidence_added", signal.id);
          if (!isFirst && (oldScore !== target.confidenceScore || oldStatus !== target.status)) timeline(target, now, "assessment_changed", null);
          return true;
        };

        let attached = false;
        if (first) {
          let attempt = 0;
          while (true) {
            const proposed = freshEvent(event.id, signal, now, inherited);
            attached = attach(proposed, true, matching);
            if (await transaction.createEventExclusive(proposed, anchor(proposed))) {
              event = proposed;
              break;
            }

            const occupied = await transaction.eventById(proposed.id);
            const collisionDecision = occupied ? matchDecision(signal, occupied) : null;
            const ambiguous = matching?.reasons.includes("rejected_ambiguous") ?? false;
            if (occupied && collisionDecision?.matched && !ambiguous) {
              event = occupied;
              matching = collisionDecision;
              first = false;
              attached = attach(event, false, matching);
              if (!await transaction.updateEvent(event, anchor(event))) {
                throw new Error(`Detection integrity error: colliding event ${event.id} disappeared during revision`);
              }
              break;
            }

            attempt++;
            if (attempt > 100) throw new Error(`Unable to allocate a collision-free event id for signal ${signal.id}`);
            event = freshEvent(`orbital:${hash(`${creationSeed}:collision:${attempt}`)}`, signal, now, inherited);
          }
        } else {
          attached = attach(event, false, matching);
          if (!await transaction.updateEvent(event, anchor(event))) {
            throw new Error(`Detection integrity error: event ${event.id} disappeared before update`);
          }
        }
        if (!attached) { skipped++; continue; }
        await transaction.remember(signal.id, event.id, digest);
        accepted++;
      }
      return { accepted, skipped };
    });
  }

  async snapshot(now = Date.now()): Promise<DetectionResponse> {
    // Comme pour l'ingestion, la purge ne partage aucun verrou de ligne avec la
    // transaction qui prendra ensuite les advisory locks de catégories.
    await this.store.transaction((transaction) => transaction.purge(now - RETENTION_MS));
    return this.store.transaction(async (transaction) => {
      const events = await transaction.recent(200);
      const updates: { event: OrbitalEvent; expected: OrbitalEvent }[] = [];
      for (const event of events) {
        const expected = structuredClone(event);
        const oldScore = event.confidenceScore;
        const oldStatus = event.status;
        assess(event, now);
        if (oldScore !== event.confidenceScore || oldStatus !== event.status) {
          timeline(event, now, "assessment_changed", null);
          updates.push({ event, expected });
        }
      }
      // Même namespace et même ordre que l'ingestion. Tous les advisory locks sont
      // acquis avant le premier UPDATE, puis les verrous de lignes suivent l'ordre ID.
      await transaction.lock([...new Set(updates.map(({ event }) => event.kind))].sort());
      for (const { event, expected } of updates.sort((first, second) => first.event.id.localeCompare(second.event.id))) {
        // UPDATE-only : un instantané ancien ne peut ni écraser une ingestion plus
        // récente, ni recréer un événement supprimé entre la lecture et l'écriture.
        await transaction.updateEventIfExists(event, anchor(event), expected);
      }
      return { generatedAt: new Date(now).toISOString(), events, live: events.filter((event) => isLive(event, now)).sort((first, second) => second.importanceScore - first.importanceScore || second.confidenceScore - first.confidenceScore).slice(0, 12), status: "ok" };
    });
  }
}
