import { describe, expect, it } from "vitest";
import { DetectionEngine } from "@/server/detection/engine";
import type { DetectionStore, DetectionTransaction } from "@/server/detection/store";
import type { OrbitalEvent, Signal } from "@/types/detection";
import { distinct, NOW, postgresContext, signal } from "./detection-store-helpers";

const databaseUrl = process.env.ORBITAL_TEST_DATABASE_URL?.trim();
const suite = databaseUrl ? describe : describe.skip;

class PauseAfterRowUpdateStore implements DetectionStore {
  readonly kind = "postgres" as const;
  private reachedResolve!: () => void;
  private releaseResolve!: () => void;
  readonly reached = new Promise<void>((resolve) => { this.reachedResolve = resolve; });
  private readonly release = new Promise<void>((resolve) => { this.releaseResolve = resolve; });

  constructor(
    private readonly inner: DetectionStore,
    private readonly method: "updateEvent" | "updateEventIfExists",
    private readonly eventId: string,
  ) {}

  resume() { this.releaseResolve(); }

  transaction<Result>(work: (transaction: DetectionTransaction) => Promise<Result>): Promise<Result> {
    return this.inner.transaction((transaction) => work(new Proxy(transaction, {
      get: (target, property, receiver) => property === this.method ? async (...args: unknown[]) => {
        const value = args[0] as OrbitalEvent;
        const result = await (target[this.method] as (...values: unknown[]) => Promise<boolean>)(...args);
        if (value.id === this.eventId) {
          this.reachedResolve();
          await this.release;
        }
        return result;
      } : Reflect.get(target, property, receiver),
    }) as DetectionTransaction));
  }

  close() { return this.inner.close(); }
}

function parisSignal(): Signal {
  return signal({
    id: "paris-seed", provider: "paris", sourceName: "Paris",
    title: "Explosion au dépôt Montsouris à Paris", text: "Explosion au dépôt Montsouris",
    occurredAt: new Date(NOW + 1_000).toISOString(), receivedAt: new Date(NOW + 1_000).toISOString(),
    position: { lat: 48.86, lon: 2.35, precision: "city" }, place: "Paris", countries: ["FRA"], entities: ["dépôt Montsouris"],
  });
}

suite("protocole anti-deadlock PostgreSQL", () => {
  it("sérialise snapshot Paris→Odessa et ingestion Odessa→Paris sans 40P01", async () => {
    for (let iteration = 0; iteration < 20; iteration++) {
      const context = await postgresContext(databaseUrl!);
      try {
        const snapshotBase = context.store;
        const ingestBase = await context.reopen();
        const seedEngine = new DetectionEngine(ingestBase);
        const odessa = signal({ id: "odessa-seed" });
        const paris = parisSignal();
        await seedEngine.ingest([odessa], NOW);
        await seedEngine.ingest([paris], NOW + 1_000);
        const seeded = (await seedEngine.snapshot(NOW + 1_000)).events;
        const parisId = seeded.find((item) => item.place === "Paris")!.id;
        const odessaId = seeded.find((item) => item.place === "Odessa")!.id;

        const snapshotStore = new PauseAfterRowUpdateStore(snapshotBase, "updateEventIfExists", parisId);
        const ingestStore = new PauseAfterRowUpdateStore(ingestBase, "updateEvent", odessaId);
        const snapshotPromise = new DetectionEngine(snapshotStore).snapshot(NOW + 6 * 3_600_000);
        await snapshotStore.reached;
        const ingestPromise = new DetectionEngine(ingestStore).ingest([
          distinct(10, { title: "Nouvelle confirmation de l'explosion au terminal Neptune Odessa" }),
          distinct(11, {
            title: "Nouvelle confirmation de l'explosion au dépôt Montsouris Paris", text: paris.text,
            occurredAt: paris.occurredAt, position: paris.position, place: paris.place, countries: paris.countries, entities: paris.entities,
          }),
        ], NOW + 60_000);

        const ingestionAlreadyHasRowLock = await Promise.race([
          ingestStore.reached.then(() => true),
          new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
        ]);
        snapshotStore.resume();
        if (!ingestionAlreadyHasRowLock) {
          await snapshotPromise;
          await ingestStore.reached;
        }
        ingestStore.resume();

        const settled = await Promise.allSettled([snapshotPromise, ingestPromise]);
        const deadlock = settled.find((result): result is PromiseRejectedResult => result.status === "rejected" && (result.reason as { code?: string }).code === "40P01");
        expect(deadlock, `SQLSTATE 40P01 à l'itération ${iteration + 1}`).toBeUndefined();
        expect(settled.every((result) => result.status === "fulfilled")).toBe(true);

        const events = (await seedEngine.snapshot(NOW + 6 * 3_600_000)).events;
        expect(events).toHaveLength(2);
        expect(events.flatMap((item) => item.evidence).map((item) => item.signal.id).sort()).toEqual([
          "odessa-seed", "paris-seed", "signal-10", "signal-11",
        ]);
        const invariants = await context.maintenance.query<{
          orphans: number; missing_evidence: number; empty_events: number; duplicate_signals: number;
        }>(`SELECT
          (SELECT count(*)::int FROM "${context.schema}".detection_signals s LEFT JOIN "${context.schema}".detection_events e ON e.id = s.event_id WHERE e.id IS NULL) AS orphans,
          (SELECT count(*)::int FROM "${context.schema}".detection_signals s JOIN "${context.schema}".detection_events e ON e.id = s.event_id
            WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(e.payload->'evidence') item WHERE item->'signal'->>'id' = s.id)) AS missing_evidence,
          (SELECT count(*)::int FROM "${context.schema}".detection_events WHERE jsonb_array_length(payload->'evidence') = 0) AS empty_events,
          (SELECT count(*)::int FROM (
            SELECT e.id, item->'signal'->>'id', count(*) FROM "${context.schema}".detection_events e
            CROSS JOIN LATERAL jsonb_array_elements(e.payload->'evidence') item
            GROUP BY e.id, item->'signal'->>'id' HAVING count(*) > 1
          ) duplicated) AS duplicate_signals`);
        expect(invariants.rows[0]).toEqual({ orphans: 0, missing_evidence: 0, empty_events: 0, duplicate_signals: 0 });
      } finally {
        await context.cleanup();
      }
    }
  }, 60_000);
});
