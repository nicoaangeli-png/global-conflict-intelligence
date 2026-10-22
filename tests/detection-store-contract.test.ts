import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { DetectionEngine } from "@/server/detection/engine";
import { RETENTION_MS } from "@/server/detection/store";
import { distinct, event, NOW, postgresContext, signal, sqliteContext, type StoreContext } from "./detection-store-helpers";

/**
 * Contrat commun SQLite / PostgreSQL.
 *
 * Ces tests n'appellent aucune logique spécifique à un backend : ils vérifient que le
 * moteur produit le même comportement et que l'interface `DetectionStore` tient ses
 * promesses (idempotence, rollback, rétention, concurrence). Ils tournent sur SQLite
 * partout, et sur PostgreSQL quand ORBITAL_TEST_DATABASE_URL pointe vers une base
 * jetable (job CI dédié).
 */
const url = process.env.ORBITAL_TEST_DATABASE_URL?.trim();

const backends: Array<{ name: string; create: () => Promise<StoreContext> }> = [
  { name: "sqlite", create: sqliteContext },
  { name: "postgres", create: () => postgresContext(url!) },
];

for (const backend of backends) {
  describe.skipIf(backend.name === "postgres" && !url)(`contrat DetectionStore — ${backend.name}`, () => {
    let context: StoreContext;

    beforeEach(async () => { context = await backend.create(); });
    afterEach(async () => { await context.cleanup(); });

    it("création exclusive, mise à jour, remember, candidats, recent et purge", async () => {
      const store = context.store;
      const older = event("older", new Date(NOW - 40 * 60_000).toISOString());
      const nearest = event("nearest", new Date(NOW).toISOString());
      const newer = event("newer", new Date(NOW + 5 * 60_000).toISOString());
      await store.transaction(async (transaction) => {
        expect(await transaction.createEventExclusive(older, NOW - 40 * 60_000)).toBe(true);
        expect(await transaction.createEventExclusive(nearest, NOW)).toBe(true);
        expect(await transaction.createEventExclusive(newer, NOW + 5 * 60_000)).toBe(true);
        expect(await transaction.createEventExclusive({ ...nearest, title: "collision" }, NOW)).toBe(false);
        await transaction.remember("signal-older", "older", "digest-older");
        await transaction.remember("signal-nearest", "nearest", "digest-nearest");

        expect(await transaction.bySignal("signal-nearest")).toMatchObject({ digest: "digest-nearest", event: { id: "nearest" } });
        expect(await transaction.bySignal("absent")).toBeNull();
        expect((await transaction.candidates("explosion", NOW, 45 * 60_000)).map((item) => item.id)).toEqual(["nearest", "newer", "older"]);
        expect((await transaction.candidates("protest", NOW, 45 * 60_000))).toEqual([]);
        expect((await transaction.recent(2)).map((item) => item.id)).toEqual(["newer", "nearest"]);

        await transaction.purge(NOW - RETENTION_MS);
        expect((await transaction.recent(10)).map((item) => item.id)).toEqual(["newer", "nearest", "older"]);
      });
    });

    it("la purge supprime les signaux par cascade", async () => {
      const store = context.store;
      await store.transaction(async (transaction) => {
        await transaction.createEventExclusive(event("old"), NOW - 8 * 86_400_000);
        await transaction.remember("old-signal", "old", "old-digest");
        await transaction.purge(NOW - RETENTION_MS);
        expect(await transaction.bySignal("old-signal")).toBeNull();
        expect(await transaction.recent(10)).toEqual([]);
      });
    });

    it("un rollback ne laisse ni événement ni signal", async () => {
      const store = context.store;
      await expect(store.transaction(async (transaction) => {
        await transaction.createEventExclusive(event("rolled-back"), NOW);
        await transaction.remember("rolled-back-signal", "rolled-back", "digest");
        throw new Error("rollback volontaire");
      })).rejects.toThrow("rollback volontaire");
      expect(await store.transaction((transaction) => transaction.recent(10))).toEqual([]);
    });

    it("une écriture plus ancienne n'écrase pas une écriture plus récente", async () => {
      const store = context.store;
      await store.transaction(async (transaction) => {
        await transaction.createEventExclusive(event("guarded", new Date(NOW).toISOString(), "version récente"), NOW);
        expect(await transaction.updateEvent(event("guarded", new Date(NOW - 60_000).toISOString(), "version ancienne"), NOW)).toBe(false);
        const [current] = await transaction.recent(10);
        expect(current.title).toBe("version récente");
      });
    });

    it("une mise à jour de snapshot ne crée jamais une ligne supprimée", async () => {
      const store = context.store;
      const original = event("snapshot-race", new Date(NOW).toISOString(), "version lue");
      const assessed = { ...original, title: "version recalculée" };
      await store.transaction(async (transaction) => {
        expect(await transaction.createEventExclusive(original, NOW)).toBe(true);
      });
      await store.transaction((transaction) => transaction.removeEvent(original.id));
      await store.transaction(async (transaction) => {
        expect(await transaction.updateEventIfExists(assessed, NOW, original)).toBe(false);
        expect(await transaction.eventById(original.id)).toBeNull();
      });
    });

    it("une mise à jour de snapshot refuse un remplacement concurrent au même timestamp", async () => {
      const store = context.store;
      const original = event("snapshot-version", new Date(NOW).toISOString(), "version lue");
      const replacement = event("snapshot-version", original.lastReceivedAt, "révision concurrente");
      const assessed = { ...original, title: "snapshot périmé" };
      await store.transaction(async (transaction) => {
        expect(await transaction.createEventExclusive(original, NOW)).toBe(true);
        expect(await transaction.updateEvent(replacement, NOW)).toBe(true);
        expect(await transaction.updateEventIfExists(assessed, NOW, original)).toBe(false);
        expect(await transaction.eventById(original.id)).toMatchObject({ title: "révision concurrente" });
      });
    });

    it("removeEvent supprime exactement ses mappings par cascade", async () => {
      const store = context.store;
      await store.transaction(async (transaction) => {
        expect(await transaction.createEventExclusive(event("cascade"), NOW)).toBe(true);
        await transaction.remember("cascade-1", "cascade", "d1");
        await transaction.remember("cascade-2", "cascade", "d2");
        expect(await transaction.signalCountForEvent("cascade")).toBe(2);
        await transaction.forget("cascade-2");
        expect(await transaction.signalCountForEvent("cascade")).toBe(1);
        expect(await transaction.bySignal("cascade-2")).toBeNull();
        await transaction.removeEvent("cascade");
        expect(await transaction.signalCountForEvent("cascade")).toBe(0);
        expect(await transaction.bySignal("cascade-1")).toBeNull();
        expect(await transaction.bySignal("cascade-2")).toBeNull();
      });
    });

    it("ingestion idempotente, révision de contenu et rétention à sept jours", async () => {
      const engine = new DetectionEngine(context.store);
      expect(await engine.ingest([signal()], NOW)).toEqual({ accepted: 1, skipped: 0 });
      expect(await engine.ingest([signal()], NOW + 1_000)).toEqual({ accepted: 0, skipped: 1 });

      const first = (await engine.snapshot(NOW)).events;
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ evidenceCount: 1, independentSourceCount: 1 });
      expect(first[0].timeline).toHaveLength(1);

      expect(await engine.ingest([signal({ text: "Correction publiée", severity: "severe" })], NOW + 2_000)).toEqual({ accepted: 1, skipped: 0 });
      const revised = (await engine.snapshot(NOW + 2_000)).events;
      expect(revised).toHaveLength(1);
      expect(revised[0].evidenceCount).toBe(1);
      expect(revised[0].timeline.some((entry) => entry.type === "evidence_updated")).toBe(true);

      expect((await engine.snapshot(NOW + RETENTION_MS + 1)).events).toEqual([]);
    });

    it("l'état complet est restauré après réouverture du store", async () => {
      const first = context.engine;
      await first.ingest([signal(), distinct(1)], NOW);
      const before = (await first.snapshot(NOW)).events;

      await context.reopen();
      const second = new DetectionEngine(context.store);
      const after = (await second.snapshot(NOW)).events;
      expect(after).toEqual(before);
      expect(await second.ingest([signal()], NOW)).toEqual({ accepted: 0, skipped: 1 });
    });

    it("deux instances qui ingèrent le même signal ne créent qu'un événement", async () => {
      const secondStore = await context.reopen();
      const firstEngine = new DetectionEngine(context.store);
      const secondEngine = new DetectionEngine(secondStore);
      const results = await Promise.all([
        firstEngine.ingest([signal()], NOW),
        secondEngine.ingest([signal()], NOW),
      ]);
      expect(results.reduce((sum, result) => sum + result.accepted, 0)).toBe(1);
      expect(results.reduce((sum, result) => sum + result.skipped, 0)).toBe(1);
      const events = (await firstEngine.snapshot(NOW)).events;
      expect(events).toHaveLength(1);
      expect(events[0].evidence).toHaveLength(1);
      expect(events[0].timeline).toHaveLength(1);
    });

    it("deux instances qui ingèrent deux signaux du même événement créent un seul cluster", async () => {
      const secondStore = await context.reopen();
      const firstEngine = new DetectionEngine(context.store);
      const secondEngine = new DetectionEngine(secondStore);
      const results = await Promise.all([
        firstEngine.ingest([distinct(0)], NOW),
        secondEngine.ingest([distinct(1)], NOW),
      ]);
      expect(results.map((result) => result.accepted)).toEqual([1, 1]);
      const events = (await firstEngine.snapshot(NOW)).events;
      expect(events).toHaveLength(1);
      expect(events[0].evidenceCount).toBe(2);
    });

    it("deux mises à jour simultanées du même événement conservent les deux preuves", async () => {
      const secondStore = await context.reopen();
      const firstEngine = new DetectionEngine(context.store);
      const secondEngine = new DetectionEngine(secondStore);
      await firstEngine.ingest([distinct(0)], NOW);
      const results = await Promise.all([
        firstEngine.ingest([distinct(1)], NOW + 1_000),
        secondEngine.ingest([distinct(2)], NOW + 1_000),
      ]);
      expect(results.map((result) => result.accepted)).toEqual([1, 1]);
      const events = (await firstEngine.snapshot(NOW + 1_000)).events;
      expect(events).toHaveLength(1);
      expect(events[0].evidenceCount).toBe(3);
      expect(new Set(events[0].evidence.map((item) => item.signal.id))).toEqual(new Set(["signal-0", "signal-1", "signal-2"]));
    });

    it("purge et ingestion simultanées restent cohérentes", async () => {
      const secondStore = await context.reopen();
      await context.store.transaction(async (transaction) => {
        await transaction.createEventExclusive(event("expired"), NOW - 8 * 86_400_000);
        await transaction.remember("expired-signal", "expired", "digest");
      });
      const ingestEngine = new DetectionEngine(secondStore);
      const [, result] = await Promise.all([
        context.store.transaction((transaction) => transaction.purge(NOW - RETENTION_MS)),
        ingestEngine.ingest([signal()], NOW),
      ]);
      expect(result.accepted).toBe(1);
      const events = (await new DetectionEngine(context.store).snapshot(NOW)).events;
      expect(events.map((item) => item.id)).not.toContain("expired");
      expect(events).toHaveLength(1);
    });
  });
}
