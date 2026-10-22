import { afterEach, describe, expect, it } from "vitest";
import { assess, DetectionEngine, MAX_EVIDENCE } from "@/server/detection/engine";
import { evidence, hash } from "@/server/detection/fingerprint";
import { matchingAnchor } from "@/server/detection/cluster";
import type { DetectionStore, DetectionTransaction } from "@/server/detection/store";
import type { OrbitalEvent, Signal, SignalKind } from "@/types/detection";
import { distinct, event, NOW, postgresContext, signal, sqliteContext, type StoreContext } from "./detection-store-helpers";

const databaseUrl = process.env.ORBITAL_TEST_DATABASE_URL;

function earthquake(id = "signal-0", overrides: Partial<Signal> = {}): Signal {
  return signal({
    id,
    provider: `quake-${id}`,
    sourceName: `Quake ${id}`,
    url: `https://quake-${id}.example/report`,
    title: "Magnitude 6.0 earthquake strikes off Tokyo near Sagami observatory",
    text: "Strong earthquake measured near the Sagami observatory off Tokyo",
    kind: "earthquake",
    nature: "sensor",
    occurredAt: new Date(NOW + 60_000).toISOString(),
    position: { lat: 35.68, lon: 139.76, precision: "city" },
    place: "Tokyo",
    countries: ["JPN"],
    entities: ["Sagami observatory"],
    confirmsOccurrence: true,
    metric: { label: "Magnitude", value: 6, unit: "M" },
    ...overrides,
  });
}

function digest(value: Signal): string {
  return hash(JSON.stringify({ ...value, receivedAt: undefined }));
}

function seededEvent(id: string, signals: Signal[], kind: Signal["kind"] = signals[0]?.kind ?? "other"): OrbitalEvent {
  return assess({
    ...event(id, new Date(NOW).toISOString(), signals[0]?.title ?? id),
    kind,
    place: signals[0]?.place ?? null,
    position: signals[0]?.position ?? null,
    countries: signals[0]?.countries ?? [],
    evidence: signals.map(evidence),
  }, NOW);
}

for (const backend of ["sqlite", "postgres"] as const) {
  describe.skipIf(backend === "postgres" && !databaseUrl)(`révisions transactionnelles ${backend}`, () => {
    let context: StoreContext;
    afterEach(async () => { await context?.cleanup(); });

    async function setup() {
      context = backend === "sqlite" ? await sqliteContext() : await postgresContext(databaseUrl!);
      return context;
    }

    it("conserve le même événement pour une révision compatible de même catégorie", async () => {
      const { engine } = await setup();
      await engine.ingest([signal()], NOW);
      const before = (await engine.snapshot(NOW)).events[0];
      const revisedSignal = signal({
        title: "Explosion corrigée au terminal Neptune du port Odessa",
        text: "Correction de la description publiée par la source",
        severity: "severe",
      });

      await engine.ingest([revisedSignal], NOW + 1_000);
      const events = (await engine.snapshot(NOW + 1_000)).events;

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        id: before.id,
        title: revisedSignal.title,
        kind: "explosion",
        place: "Odessa",
        evidenceCount: 1,
      });
      expect(events[0].evidence[0].signal).toMatchObject({ id: revisedSignal.id, title: revisedSignal.title });
    });

    it("recrée une identité complète lors d'une révision vers une autre catégorie et un autre lieu", async () => {
      const { engine } = await setup();
      await engine.ingest([signal()], NOW);
      await engine.ingest([earthquake()], NOW + 60_000);

      const events = (await engine.snapshot(NOW + 60_000)).events;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        title: earthquake().title,
        kind: "earthquake",
        place: "Tokyo",
        countries: ["JPN"],
        position: { lat: 35.68, lon: 139.76 },
        evidenceCount: 1,
      });
      expect(events[0].importanceReasons).toContain("category:earthquake:+40");
      expect(events[0].timeline).toEqual([expect.objectContaining({ type: "first_signal", signalId: "signal-0" })]);
    });

    it("détache seulement la preuve révisée d'un événement multi-preuves", async () => {
      const { engine } = await setup();
      const remaining = distinct(1, { title: "Explosion confirmée au terminal Neptune du port Odessa par une seconde équipe" });
      await engine.ingest([signal(), remaining], NOW);
      await engine.ingest([earthquake()], NOW + 60_000);

      const events = (await engine.snapshot(NOW + 60_000)).events;
      expect(events).toHaveLength(2);
      const explosion = events.find((item) => item.kind === "explosion");
      const quake = events.find((item) => item.kind === "earthquake");
      expect(explosion).toMatchObject({ title: remaining.title, place: remaining.place, evidenceCount: 1 });
      expect(explosion?.evidence.map((item) => item.signal.id)).toEqual([remaining.id]);
      expect(explosion?.timeline.some((entry) => entry.type === "evidence_removed" && entry.signalId === "signal-0")).toBe(true);
      expect(quake).toMatchObject({ title: earthquake().title, place: "Tokyo", evidenceCount: 1 });
      expect(quake?.evidence.map((item) => item.signal.id)).toEqual(["signal-0"]);
    });

    it("supprime un ancien événement devenu réellement vide", async () => {
      const { store, engine } = await setup();
      const original = signal();
      const legacy = assess({
        ...event("legacy-event", new Date(NOW).toISOString(), original.title),
        kind: original.kind,
        place: original.place,
        position: original.position,
        countries: original.countries,
        evidence: [evidence(original)],
      }, NOW);
      await store.transaction(async (transaction) => {
        await transaction.lock([legacy.kind]);
        await transaction.createEventExclusive(legacy, matchingAnchor(legacy));
        await transaction.remember(original.id, legacy.id, digest(original));
      });

      await engine.ingest([earthquake()], NOW + 60_000);
      const events = (await engine.snapshot(NOW + 60_000)).events;
      expect(events.some((item) => item.id === legacy.id)).toBe(false);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: "earthquake", place: "Tokyo" });
    });

    it("reclusterise la preuve révisée vers un événement compatible existant", async () => {
      const { engine } = await setup();
      const target = earthquake("signal-2");
      await engine.ingest([signal(), target], NOW);
      const targetId = (await engine.snapshot(NOW)).events.find((item) => item.kind === "earthquake")!.id;

      await engine.ingest([earthquake("signal-0")], NOW + 60_000);
      const events = (await engine.snapshot(NOW + 60_000)).events;

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ id: targetId, kind: "earthquake", place: "Tokyo", evidenceCount: 2 });
      expect(events[0].evidence.map((item) => item.signal.id).sort()).toEqual(["signal-0", "signal-2"]);
    });

    it("conserve les mappings exacts après détachement et suppression CASCADE", async () => {
      const { store, engine } = await setup();
      const remaining = distinct(1);
      await engine.ingest([signal(), remaining], NOW);
      const oldId = (await engine.snapshot(NOW)).events[0].id;

      await engine.ingest([earthquake()], NOW + 60_000);

      await store.transaction(async (transaction) => {
        expect(await transaction.bySignal(remaining.id)).toMatchObject({ event: { id: oldId } });
        expect(await transaction.bySignal("signal-0")).toMatchObject({ event: { kind: "earthquake" } });
        expect(await transaction.signalCountForEvent(oldId)).toBe(1);
      });
    });

    it("ne crée aucun mapping caché lorsque MAX_EVIDENCE est atteint", async () => {
      const { store, engine } = await setup();
      const initial = Array.from({ length: MAX_EVIDENCE }, (_, index) => distinct(index));
      expect(await engine.ingest(initial, NOW)).toEqual({ accepted: MAX_EVIDENCE, skipped: 0 });
      const eventId = (await engine.snapshot(NOW)).events[0].id;
      const overflow = distinct(MAX_EVIDENCE);

      expect(await engine.ingest([overflow], NOW + 1_000)).toEqual({ accepted: 0, skipped: 1 });
      let snapshot = (await engine.snapshot(NOW + 1_000)).events[0];
      expect(snapshot.evidence).toHaveLength(MAX_EVIDENCE);
      expect(snapshot.evidenceTruncated).toBe(true);
      await store.transaction(async (transaction) => {
        expect(await transaction.bySignal(overflow.id)).toBeNull();
        expect(await transaction.signalCountForEvent(eventId)).toBe(snapshot.evidence.length);
      });

      expect(await engine.ingest([overflow], NOW + 2_000)).toEqual({ accepted: 0, skipped: 1 });
      const revisedOverflow = { ...overflow, text: "Correction après saturation" };
      await expect(engine.ingest([revisedOverflow], NOW + 3_000)).resolves.toEqual({ accepted: 0, skipped: 1 });
      snapshot = (await engine.snapshot(NOW + 3_000)).events[0];
      expect(snapshot.evidence.map((item) => item.signal.id)).not.toContain(overflow.id);
      await store.transaction(async (transaction) => {
        expect(await transaction.bySignal(overflow.id)).toBeNull();
        expect(await transaction.signalCountForEvent(eventId)).toBe(snapshot.evidence.length);
      });
    }, 30_000);

    it("refuse explicitement un mapping dont la preuve est absente du payload", async () => {
      const { store, engine } = await setup();
      const inconsistent = seededEvent("inconsistent", [distinct(1)]);
      await store.transaction(async (transaction) => {
        expect(await transaction.createEventExclusive(inconsistent, matchingAnchor(inconsistent))).toBe(true);
        await transaction.remember("signal-0", inconsistent.id, digest(signal()));
      });

      await expect(engine.ingest([earthquake()], NOW + 60_000)).rejects.toThrow(/integrity.*signal-0/i);
      await store.transaction(async (transaction) => {
        expect(await transaction.bySignal("signal-0")).toMatchObject({ event: { id: inconsistent.id } });
        expect(await transaction.signalCountForEvent(inconsistent.id)).toBe(1);
      });
    });

    it("n'écrase jamais un événement multi-preuves lors d'une collision d'identifiant", async () => {
      const { store, engine } = await setup();
      const original = signal();
      await engine.ingest([original], NOW);
      const originId = (await engine.snapshot(NOW)).events[0].id;
      const revised = earthquake();
      const collisionId = `orbital:${hash(`${revised.id}:${digest(revised)}:${originId}`)}`;
      const occupantSignals = [
        earthquake("occupant-1", { title: "Séisme mesuré près de Paris au réseau Montsouris", place: "Paris", countries: ["FRA"], position: { lat: 48.86, lon: 2.35, precision: "city" }, entities: ["réseau Montsouris"] }),
        earthquake("occupant-2", { title: "Deuxième mesure du séisme parisien au réseau Montsouris", place: "Paris", countries: ["FRA"], position: { lat: 48.86, lon: 2.35, precision: "city" }, entities: ["réseau Montsouris"] }),
      ];
      const occupant = seededEvent(collisionId, occupantSignals, "earthquake");
      await store.transaction(async (transaction) => {
        expect(await transaction.createEventExclusive(occupant, matchingAnchor(occupant))).toBe(true);
        for (const item of occupantSignals) await transaction.remember(item.id, occupant.id, digest(item));
      });

      await engine.ingest([revised], NOW + 60_000);
      const events = (await engine.snapshot(NOW + 60_000)).events;
      const preserved = events.find((item) => item.id === collisionId);
      expect(preserved?.evidence.map((item) => item.signal.id).sort()).toEqual(["occupant-1", "occupant-2"]);
      expect(events.find((item) => item.evidence.some((item) => item.signal.id === revised.id))?.id).not.toBe(collisionId);
    });

    it("rejoint explicitement l'occupant compatible d'un identifiant dérivé", async () => {
      const { store } = await setup();
      const blindCandidates: DetectionStore = {
        kind: store.kind,
        transaction: (work) => store.transaction((transaction) => work(new Proxy(transaction, {
          get: (target, property, receiver) => property === "candidates" ? async () => [] : Reflect.get(target, property, receiver),
        }) as DetectionTransaction)),
        close: async () => undefined,
      };
      const engine = new DetectionEngine(blindCandidates);
      const original = signal();
      await engine.ingest([original], NOW);
      const originId = (await engine.snapshot(NOW)).events[0].id;
      const revised = earthquake("signal-0");
      const collisionId = `orbital:${hash(`${revised.id}:${digest(revised)}:${originId}`)}`;
      const occupantSignal = earthquake("compatible-occupant");
      const occupant = seededEvent(collisionId, [occupantSignal], "earthquake");
      await store.transaction(async (transaction) => {
        expect(await transaction.createEventExclusive(occupant, matchingAnchor(occupant))).toBe(true);
        await transaction.remember(occupantSignal.id, occupant.id, digest(occupantSignal));
      });

      await engine.ingest([revised], NOW + 60_000);
      const events = (await engine.snapshot(NOW + 60_000)).events;
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(collisionId);
      expect(events[0].evidence.map((item) => item.signal.id).sort()).toEqual(["compatible-occupant", "signal-0"]);
    });

    it("alloue une identité alternative si la collision suit un rejet ambigu", async () => {
      const { store, engine } = await setup();
      const original = signal();
      await engine.ingest([original], NOW);
      const originId = (await engine.snapshot(NOW)).events[0].id;
      const revised = earthquake();
      const collisionId = `orbital:${hash(`${revised.id}:${digest(revised)}:${originId}`)}`;
      const first = seededEvent(collisionId, [earthquake("candidate-1")], "earthquake");
      const second = seededEvent("ambiguous-candidate", [earthquake("candidate-2")], "earthquake");
      await store.transaction(async (transaction) => {
        expect(await transaction.createEventExclusive(first, matchingAnchor(first))).toBe(true);
        expect(await transaction.createEventExclusive(second, matchingAnchor(second))).toBe(true);
      });

      await engine.ingest([revised], NOW + 60_000);
      const events = (await engine.snapshot(NOW + 60_000)).events;
      expect(events.find((item) => item.id === collisionId)?.evidence.map((item) => item.signal.id)).toEqual(["candidate-1"]);
      expect(events.find((item) => item.id === "ambiguous-candidate")?.evidence.map((item) => item.signal.id)).toEqual(["candidate-2"]);
      expect(events.find((item) => item.evidence.some((item) => item.signal.id === revised.id))?.id).not.toBe(collisionId);
    });

    it("reste déterministe sur des révisions successives A → B → A → B", async () => {
      const { engine } = await setup();
      const versionA = signal();
      const versionB = earthquake();
      await engine.ingest([versionA], NOW);
      await engine.ingest([versionB], NOW + 60_000);
      await engine.ingest([versionA], NOW + 120_000);
      await engine.ingest([versionB], NOW + 180_000);
      const events = (await engine.snapshot(NOW + 180_000)).events;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: "earthquake", place: "Tokyo", evidenceCount: 1 });
      expect(events[0].evidence[0].signal.id).toBe("signal-0");
    });
  });
}

class ReadCommittedRaceStore implements DetectionStore {
  readonly kind = "postgres" as const;
  private events = new Map<string, { event: OrbitalEvent; anchor: number }>();
  private signals = new Map<string, { eventId: string; digest: string }>();
  private pauseNextRecent = false;
  private readReached: (() => void) | null = null;
  private releaseRead: (() => void) | null = null;
  readonly recentRead = new Promise<void>((resolve) => { this.readReached = resolve; });

  pauseSnapshotAfterRead() { this.pauseNextRecent = true; }
  resumeSnapshot() { this.releaseRead?.(); }

  async transaction<Result>(work: (transaction: DetectionTransaction) => Promise<Result>): Promise<Result> {
    const clone = (value: OrbitalEvent) => structuredClone(value);
    const transaction = {
      lockSignals: async () => undefined,
      lock: async () => undefined,
      bySignal: async (id: string) => {
        const mapping = this.signals.get(id);
        const stored = mapping && this.events.get(mapping.eventId);
        return mapping && stored ? { event: clone(stored.event), digest: mapping.digest } : null;
      },
      eventById: async (id: string) => this.events.has(id) ? clone(this.events.get(id)!.event) : null,
      candidates: async (kind: SignalKind, time: number, window: number) => [...this.events.values()]
        .filter((item) => item.event.kind === kind && Math.abs(item.anchor - time) <= window)
        .map((item) => clone(item.event)),
      createEventExclusive: async (value: OrbitalEvent, anchor: number) => {
        if (this.events.has(value.id)) return false;
        this.events.set(value.id, { event: clone(value), anchor });
        return true;
      },
      updateEvent: async (value: OrbitalEvent, anchor: number) => {
        if (!this.events.has(value.id)) return false;
        this.events.set(value.id, { event: clone(value), anchor });
        return true;
      },
      updateEventIfExists: async (value: OrbitalEvent, anchor: number, expected: OrbitalEvent) => {
        const current = this.events.get(value.id);
        if (!current || JSON.stringify(current.event) !== JSON.stringify(expected)) return false;
        this.events.set(value.id, { event: clone(value), anchor });
        return true;
      },
      removeEvent: async (id: string) => {
        this.events.delete(id);
        for (const [signalId, mapping] of this.signals) if (mapping.eventId === id) this.signals.delete(signalId);
      },
      forget: async (id: string) => { this.signals.delete(id); },
      remember: async (id: string, eventId: string, valueDigest: string) => { this.signals.set(id, { eventId, digest: valueDigest }); },
      signalCountForEvent: async (eventId: string) => [...this.signals.values()].filter((item) => item.eventId === eventId).length,
      recent: async (limit: number) => {
        const result = [...this.events.values()].map((item) => clone(item.event)).slice(0, limit);
        if (this.pauseNextRecent) {
          this.pauseNextRecent = false;
          this.readReached?.();
          await new Promise<void>((resolve) => { this.releaseRead = resolve; });
        }
        return result;
      },
      purge: async () => undefined,
    } as unknown as DetectionTransaction;
    return work(transaction);
  }

  async close() {}
}

describe("course snapshot/révision", () => {
  it("ne ressuscite pas un événement supprimé après la lecture du snapshot", async () => {
    const store = new ReadCommittedRaceStore();
    const engine = new DetectionEngine(store);
    await engine.ingest([signal()], NOW);
    const oldId = `orbital:${hash(signal().id)}`;
    store.pauseSnapshotAfterRead();
    const snapshot = engine.snapshot(NOW + 6 * 3_600_000);
    await store.recentRead;

    await engine.ingest([earthquake()], NOW + 60_000);
    store.resumeSnapshot();
    await snapshot;

    const events = await engine.snapshot(NOW + 6 * 3_600_000);
    expect(events.events.some((item) => item.id === oldId)).toBe(false);
    expect(events.events).toHaveLength(1);
    expect(events.events[0].kind).toBe("earthquake");
  });
});

class RecordingStore implements DetectionStore {
  readonly kind = "sqlite" as const;
  readonly signalLocks: string[][] = [];
  readonly categoryLocks: string[][] = [];

  constructor(private readonly inner: DetectionStore) {}

  transaction<Result>(work: (transaction: DetectionTransaction) => Promise<Result>): Promise<Result> {
    return this.inner.transaction((transaction) => work(new Proxy(transaction, {
      get: (target, property, receiver) => {
        if (property === "lockSignals") {
          return async (ids: readonly string[]) => {
            this.signalLocks.push([...ids]);
            const method = Reflect.get(target, property, receiver) as ((values: readonly string[]) => Promise<void>) | undefined;
            if (method) await method.call(target, ids);
          };
        }
        if (property === "lock") {
          return async (kinds: Parameters<DetectionTransaction["lock"]>[0]) => {
            this.categoryLocks.push([...kinds]);
            await target.lock(kinds);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as DetectionTransaction));
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

describe("verrouillage des révisions", () => {
  it("verrouille le signal puis les anciennes et nouvelles catégories dans un ordre déterministe", async () => {
    const base = await sqliteContext();
    const store = new RecordingStore(base.store);
    const engine = new DetectionEngine(store);
    try {
      await engine.ingest([signal()], NOW);
      store.signalLocks.length = 0;
      store.categoryLocks.length = 0;

      await engine.ingest([earthquake()], NOW + 60_000);

      expect(store.signalLocks).toEqual([["signal-0"]]);
      expect(store.categoryLocks).toEqual([["earthquake", "explosion"]]);
    } finally {
      await base.cleanup();
    }
  });

  it("verrouille aussi les catégories portées par les preuves historiques incohérentes", async () => {
    const base = await sqliteContext();
    const store = new RecordingStore(base.store);
    const engine = new DetectionEngine(store);
    const original = signal();
    const historicalEarthquake = earthquake("historical-quake");
    const corrupt = seededEvent("historical-mixed", [original, historicalEarthquake], "explosion");
    try {
      await base.store.transaction(async (transaction) => {
        await transaction.createEventExclusive(corrupt, matchingAnchor(corrupt));
        await transaction.remember(original.id, corrupt.id, digest(original));
        await transaction.remember(historicalEarthquake.id, corrupt.id, digest(historicalEarthquake));
      });
      store.signalLocks.length = 0;
      store.categoryLocks.length = 0;

      await engine.ingest([earthquake("signal-0", { kind: "weather", title: "Alerte météo révisée à Tokyo" })], NOW + 60_000);

      expect(store.signalLocks).toEqual([["signal-0"]]);
      expect(store.categoryLocks).toEqual([["earthquake", "explosion", "weather"]]);
    } finally {
      await base.cleanup();
    }
  });
});

describe.skipIf(!databaseUrl)("courses de révision PostgreSQL", () => {
  async function sqlInvariants(context: Awaited<ReturnType<typeof postgresContext>>) {
    return context.maintenance.query<{
      orphans: number; missing_evidence: number; empty_events: number; duplicate_signals: number;
    }>(`SELECT
      (SELECT count(*)::int FROM "${context.schema}".detection_signals s LEFT JOIN "${context.schema}".detection_events e ON e.id = s.event_id WHERE e.id IS NULL) AS orphans,
      (SELECT count(*)::int FROM "${context.schema}".detection_signals s JOIN "${context.schema}".detection_events e ON e.id = s.event_id
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(e.payload->'evidence') item WHERE item->'signal'->>'id' = s.id)) AS missing_evidence,
      (SELECT count(*)::int FROM "${context.schema}".detection_events WHERE jsonb_array_length(payload->'evidence') = 0) AS empty_events,
      (SELECT count(*)::int FROM (
        SELECT item->'signal'->>'id', count(*) FROM "${context.schema}".detection_events e
        CROSS JOIN LATERAL jsonb_array_elements(e.payload->'evidence') item
        GROUP BY item->'signal'->>'id' HAVING count(*) > 1
      ) duplicated) AS duplicate_signals`);
  }

  it("sérialise deux révisions simultanées du même signal", async () => {
    const context = await postgresContext(databaseUrl!);
    try {
      const secondStore = await context.reopen();
      const firstEngine = new DetectionEngine(context.store);
      const secondEngine = new DetectionEngine(secondStore);
      await firstEngine.ingest([signal()], NOW);
      const revisions = [
        signal({ title: "Explosion révisée A au terminal Neptune", text: "Correction A" }),
        signal({ title: "Explosion révisée B au terminal Neptune", text: "Correction B" }),
      ];

      const settled = await Promise.allSettled([
        firstEngine.ingest([revisions[0]], NOW + 1_000),
        secondEngine.ingest([revisions[1]], NOW + 2_000),
      ]);
      expect(settled.every((result) => result.status === "fulfilled")).toBe(true);
      expect(settled.some((result) => result.status === "rejected" && (result.reason as { code?: string }).code === "40P01")).toBe(false);

      const events = (await firstEngine.snapshot(NOW + 2_000)).events;
      expect(events).toHaveLength(1);
      expect(events[0].evidence.map((item) => item.signal.id)).toEqual(["signal-0"]);
      expect(revisions.map((item) => item.title)).toContain(events[0].evidence[0].signal.title);
      await context.store.transaction(async (transaction) => {
        const mapping = await transaction.bySignal("signal-0");
        expect(mapping?.event.id).toBe(events[0].id);
        expect(mapping?.event.evidence.map((item) => item.signal.id)).toEqual(["signal-0"]);
      });
      expect((await sqlInvariants(context)).rows[0]).toEqual({ orphans: 0, missing_evidence: 0, empty_events: 0, duplicate_signals: 0 });
    } finally {
      await context.cleanup();
    }
  });

  it("reclusterise sans perte deux preuves du même événement révisées simultanément", async () => {
    const context = await postgresContext(databaseUrl!);
    try {
      const secondStore = await context.reopen();
      const firstEngine = new DetectionEngine(context.store);
      const secondEngine = new DetectionEngine(secondStore);
      await firstEngine.ingest([distinct(1), distinct(2)], NOW);
      const oldId = (await firstEngine.snapshot(NOW)).events[0].id;
      const revisions = [earthquake("signal-1"), earthquake("signal-2")];

      const settled = await Promise.allSettled([
        firstEngine.ingest([revisions[0]], NOW + 60_000),
        secondEngine.ingest([revisions[1]], NOW + 61_000),
      ]);
      expect(settled.every((result) => result.status === "fulfilled")).toBe(true);
      expect(settled.some((result) => result.status === "rejected" && (result.reason as { code?: string }).code === "40P01")).toBe(false);

      const events = (await firstEngine.snapshot(NOW + 61_000)).events;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: "earthquake", place: "Tokyo", evidenceCount: 2 });
      expect(events[0].id).not.toBe(oldId);
      expect(events[0].evidence.map((item) => item.signal.id).sort()).toEqual(["signal-1", "signal-2"]);
      await context.store.transaction(async (transaction) => {
        expect((await transaction.bySignal("signal-1"))?.event.id).toBe(events[0].id);
        expect((await transaction.bySignal("signal-2"))?.event.id).toBe(events[0].id);
        expect(await transaction.signalCountForEvent(events[0].id)).toBe(2);
      });
      expect((await sqlInvariants(context)).rows[0]).toEqual({ orphans: 0, missing_evidence: 0, empty_events: 0, duplicate_signals: 0 });
    } finally {
      await context.cleanup();
    }
  });
});
