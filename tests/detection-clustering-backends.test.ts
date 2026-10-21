import { afterEach, describe, expect, it } from "vitest";
import { assess, DetectionEngine } from "@/server/detection/engine";
import { matchDecision, matchingAnchor } from "@/server/detection/cluster";
import { evidence, independence } from "@/server/detection/fingerprint";
import { distinct, event, NOW, postgresContext, sqliteContext, type StoreContext } from "./detection-store-helpers";
import type { Signal } from "@/types/detection";

function independentSignal(index: number, overrides: Partial<Signal> = {}): Signal {
  return distinct(index, { title: `Explosion au terminal Neptune du port Odessa, témoignage reportagecode${index}unique spécifique`, ...overrides });
}

const databaseUrl = process.env.ORBITAL_TEST_DATABASE_URL;
for (const backend of ["sqlite", "postgres"] as const) {
  describe.skipIf(backend === "postgres" && !databaseUrl)(`clustering intégré ${backend}`, () => {
    let context: StoreContext;
    afterEach(async () => { await context?.cleanup(); });
    async function setup() { context = backend === "sqlite" ? await sqliteContext() : await postgresContext(databaseUrl!); return context; }
    async function seed(signals: Signal[]) {
      const candidate = assess({ ...event("seed"), evidence: independence(signals.map((signal) => evidence(signal))) }, NOW);
      await context.store.transaction(async (transaction) => { await transaction.lock([candidate.kind]); await transaction.put(candidate, matchingAnchor(candidate)); });
      return candidate;
    }
    it("dix preuves et une preuve vieille de dix heures ne cachent pas le candidat", async () => {
      await setup();
      const candidate = await seed([independentSignal(99, { occurredAt: new Date(NOW - 10 * 3_600_000).toISOString() }), ...Array.from({ length: 10 }, (_, index) => independentSignal(index))]);
      expect(matchDecision(distinct(11), candidate)).toMatchObject({ matched: true, positiveFactors: expect.arrayContaining(["ignored_outliers"]) });
      await context.engine.ingest([distinct(11)], NOW);
      expect((await context.engine.snapshot(NOW)).events).toHaveLength(1);
    });
    it("huit preuves et un premier outlier éloigné gardent leur position consensuelle", async () => {
      await setup();
      await seed([independentSignal(99, { position: { lat: 0, lon: 0, precision: "point" } }), ...Array.from({ length: 8 }, (_, index) => independentSignal(index))]);
      await context.engine.ingest([distinct(11)], NOW);
      const snapshot = await context.engine.snapshot(NOW);
      expect(snapshot.events).toHaveLength(1);
      expect(snapshot.events[0].position).toMatchObject({ lat: 46.48, lon: 30.73 });
      expect(snapshot.events[0].evidence.at(-1)?.matching?.matched).toBe(true);
    });
    it.each([["Kyiv", "Kiev"], ["Odesa", "Odessa"], ["Tehran", "Teheran"]])("alias %s/%s persistés", async (first, second) => {
      await setup();
      await context.engine.ingest([distinct(0, { place: first }), distinct(1, { place: second })], NOW);
      expect((await context.engine.snapshot(NOW)).events).toHaveLength(1);
      const reopened = new DetectionEngine(await context.reopen());
      expect((await reopened.snapshot(NOW)).events[0].evidenceCount).toBe(2);
    });
    it("refuse même ville trois heures après et catégorie différente", async () => {
      await setup();
      await context.engine.ingest([distinct(0), distinct(1, { occurredAt: new Date(NOW - 3 * 3_600_000).toISOString() }), distinct(2, { kind: "earthquake" })], NOW);
      expect((await context.engine.snapshot(NOW)).events).toHaveLength(3);
    });
    it("80 provenances, corroboration concurrente et conservation après réouverture", async () => {
      await setup();
      await context.engine.ingest(Array.from({ length: 80 }, (_, index) => independentSignal(index)), NOW);
      const second = new DetectionEngine(await context.reopen());
      await Promise.all([context.engine.ingest([independentSignal(81)], NOW), second.ingest([independentSignal(82)], NOW)]);
      const snapshot = await second.snapshot(NOW);
      expect(snapshot.events).toHaveLength(1);
      expect(snapshot.events[0]).toMatchObject({ evidenceCount: 82, independentSourceCount: 82 });
    });
    it("rejette les dates invalides sans les transformer en occurrence inconnue", async () => {
      await setup();
      expect(await context.engine.ingest([distinct(0, { occurredAt: "invalid" })], NOW)).toEqual({ accepted: 0, skipped: 1 });
    });
  });
}
