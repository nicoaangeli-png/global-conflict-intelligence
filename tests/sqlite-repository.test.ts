import type { ConflictEvent } from "@/types/conflict";
import { createRepository, LocalRepository } from "@/server/repository";
import { SQLITE_UPSERT_BATCH_SIZE, SqliteRepository } from "@/server/sqliteRepository";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { migrateJsonToSqlite } = require("../scripts/migrate-json-to-sqlite.cjs") as {
  migrateJsonToSqlite(source: string, target: string): Promise<{
    sourceRecords: number;
    distinctSourceRecords: number;
    before: number;
    after: number;
    inserted: number;
    updated: number;
    missing: number;
    payloadMismatches: number;
    sourceUnchanged: boolean;
    verified: boolean;
  }>;
};

const NOW = new Date("2026-10-18T12:00:00.000Z");
const temporaryDirectories: string[] = [];

function fixtureEvent(
  id: string,
  sourceDataset: string,
  eventDate: string,
  overrides: Partial<ConflictEvent> & Record<string, unknown> = {},
): ConflictEvent {
  return {
    id,
    latitude: 48.8566,
    longitude: 2.3522,
    country: "France",
    region: "Ile-de-France",
    locality: "Paris",
    eventType: sourceDataset === "firms" ? "Thermal anomaly" : sourceDataset === "gdelt" ? "Media signal" : "Battles",
    subEventType: "fixture",
    actors: ["Fixture actor"],
    fatalities: 0,
    source: sourceDataset === "firms" ? "NASA FIRMS" : sourceDataset === "gdelt" ? "GDELT" : "Fixture source",
    sourceUrl: `https://example.test/${id}`,
    sourceDataset,
    confidence: sourceDataset === "gdelt" ? "MEDIA_SIGNAL" : "REPORTED",
    eventDate,
    updatedAt: "2026-10-18T11:00:00.000Z",
    ...overrides,
  } as ConflictEvent;
}

async function temporaryPath(filename: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "orbital-sqlite-test-"));
  temporaryDirectories.push(directory);
  return path.join(directory, filename);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("SqliteRepository", () => {
  it("est le stockage par défaut, tout en conservant JSON explicite et PostgreSQL", () => {
    const previous = {
      databaseUrl: process.env.DATABASE_URL,
      storage: process.env.ORBITAL_STORAGE,
    };
    try {
      delete process.env.DATABASE_URL;
      delete process.env.ORBITAL_STORAGE;
      expect(createRepository().kind).toBe("sqlite");
      process.env.ORBITAL_STORAGE = "json";
      expect(createRepository().kind).toBe("local");
      process.env.DATABASE_URL = "postgresql://fixture.invalid/orbital";
      expect(createRepository().kind).toBe("postgres");
    } finally {
      if (previous.databaseUrl == null) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.databaseUrl;
      if (previous.storage == null) delete process.env.ORBITAL_STORAGE;
      else process.env.ORBITAL_STORAGE = previous.storage;
    }
  });

  it("upsert les événements, déduplique par id et conserve le JSON complet", async () => {
    const filename = await temporaryPath("events.sqlite");
    const repository = new SqliteRepository(filename, {
      now: () => NOW,
      gdeltRetentionDays: 30,
      firmsRetentionDays: 14,
    });
    await repository.init();
    const first = fixtureEvent("ucdp:1", "ucdp", "2026-10-17T10:00:00.000Z", {
      title: "Titre provenant de la source",
      geoPrecision: "city",
      countryIso3: "FRA",
      provenance: { license: "fixture" },
    });
    expect(await repository.upsert([first])).toEqual({ inserted: 1, updated: 0 });

    const replacement = { ...first, fatalities: 3, title: "Titre corrigé" } as ConflictEvent;
    expect(await repository.upsert([replacement])).toEqual({ inserted: 0, updated: 1 });
    expect(await repository.counts()).toMatchObject({ total: 1, byDataset: { ucdp: 1 } });
    expect(await repository.byIds([first.id])).toEqual([replacement]);
    repository.close();

    const inspection = new DatabaseSync(filename, { readOnly: true });
    expect(inspection.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    const indexes = inspection.prepare("PRAGMA index_list('conflict_events')").all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining([
      "conflict_events_event_ts_idx",
      "conflict_events_dataset_event_ts_idx",
      "conflict_events_country_iso3_event_ts_idx",
    ]));
    inspection.close();
  });

  it("annule entièrement un lot si une ligne ne peut pas être écrite", async () => {
    const repository = new SqliteRepository(await temporaryPath("transaction.sqlite"), { now: () => NOW });
    await repository.init();
    const valid = fixtureEvent("ucdp:valid", "ucdp", "2026-10-17T10:00:00.000Z");
    const invalid = fixtureEvent("ucdp:invalid", "ucdp", "2026-10-17T11:00:00.000Z", { latitude: Number.NaN });
    await expect(repository.upsert([valid, invalid])).rejects.toThrow();
    expect(await repository.counts()).toMatchObject({ total: 0, byDataset: {} });
    repository.close();
  });

  it("applique en SQL les filtres date, pays, type et dataset", async () => {
    const repository = new SqliteRepository(await temporaryPath("filters.sqlite"), { now: () => NOW });
    await repository.init();
    await repository.upsert([
      fixtureEvent("ucdp:fr", "ucdp", "2026-10-17T10:00:00.000Z", { countryIso3: "FRA" }),
      fixtureEvent("gdelt:fr", "gdelt", "2026-10-17T11:00:00.000Z", { countryIso3: "FRA" }),
      fixtureEvent("firms:de", "firms", "2026-10-16T11:00:00.000Z", { country: "Germany", countryIso3: "DEU" }),
      fixtureEvent("ucdp:old", "ucdp", "2025-01-01T00:00:00.000Z", { countryIso3: "FRA" }),
    ]);

    const selected = await repository.query({
      from: new Date("2026-10-17T00:00:00.000Z"),
      to: new Date("2026-10-18T00:00:00.000Z"),
      countries: ["FRA"],
      types: ["Battles"],
      datasets: ["ucdp"],
    });
    expect(selected.map((event) => event.id)).toEqual(["ucdp:fr"]);
    repository.close();
  });

  it("reproduit Date.parse et les bornes inclusives de LocalRepository", async () => {
    const source = await temporaryPath("intel-events.json");
    const sqlite = path.join(path.dirname(source), "events.sqlite");
    const events = [
      fixtureEvent("ucdp:z", "ucdp", "2026-10-18T12:00:00Z"),
      fixtureEvent("ucdp:offset-boundary", "ucdp", "2026-10-18T07:00:00-05:00"),
      fixtureEvent("ucdp:offset-future", "ucdp", "2026-10-18T12:00:00-05:00"),
      fixtureEvent("ucdp:invalid-date", "ucdp", "date-invalide"),
    ];
    await writeFile(source, JSON.stringify(events));
    const local = new LocalRepository(source);
    const repository = new SqliteRepository(sqlite, { applyRetention: false });
    await local.init();
    await repository.init();

    const exact = {
      from: new Date("2026-10-18T12:00:00.000Z"),
      to: new Date("2026-10-18T12:00:00.000Z"),
    };
    const localIds = (await local.query(exact)).map((event) => event.id).sort();
    const sqliteIds = (await repository.query(exact)).map((event) => event.id).sort();
    expect(sqliteIds).toEqual(localIds);
    expect(sqliteIds).toEqual(["ucdp:offset-boundary", "ucdp:z"]);
    expect((await repository.query({ from: new Date(0), to: NOW })).map((event) => event.id))
      .not.toContain("ucdp:invalid-date");
    repository.close();
  });

  it("met à niveau une base existante et rétroremplit event_ts depuis payload", async () => {
    const filename = await temporaryPath("legacy.sqlite");
    const legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE conflict_events (
        id TEXT PRIMARY KEY, source_dataset TEXT NOT NULL, event_type TEXT NOT NULL,
        country TEXT NOT NULL DEFAULT '', country_iso3 TEXT, confidence TEXT NOT NULL,
        fatalities INTEGER NOT NULL DEFAULT 0, event_date TEXT NOT NULL,
        lat REAL NOT NULL, lon REAL NOT NULL, updated_at TEXT NOT NULL,
        payload TEXT NOT NULL CHECK (json_valid(payload))
      ) STRICT;
    `);
    const valid = fixtureEvent("ucdp:legacy-valid", "ucdp", "2026-10-18T07:00:00-05:00");
    const invalid = fixtureEvent("ucdp:legacy-invalid", "ucdp", "date-invalide");
    const insert = legacy.prepare(`
      INSERT INTO conflict_events
        (id, source_dataset, event_type, country, confidence, fatalities, event_date, lat, lon, updated_at, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const event of [valid, invalid]) {
      insert.run(event.id, event.sourceDataset, event.eventType, event.country, event.confidence,
        event.fatalities, event.eventDate, event.latitude, event.longitude, event.updatedAt, JSON.stringify(event));
    }
    legacy.close();

    const repository = new SqliteRepository(filename, { applyRetention: false });
    await repository.init();
    repository.close();
    const inspection = new DatabaseSync(filename, { readOnly: true });
    const rows = inspection.prepare("SELECT id, event_ts FROM conflict_events ORDER BY id").all();
    expect(rows).toEqual([
      { id: "ucdp:legacy-invalid", event_ts: null },
      { id: "ucdp:legacy-valid", event_ts: Date.parse(valid.eventDate) },
    ]);
    inspection.close();
  });

  it("importe le JSON historique à l'initialisation d'une base vide", async () => {
    const source = await temporaryPath("intel-events.json");
    const target = path.join(path.dirname(source), "events.sqlite");
    const events = [
      fixtureEvent("ucdp:initial-1", "ucdp", "2026-10-18T10:00:00Z"),
      fixtureEvent("ucdp:initial-2", "ucdp", "2026-10-18T06:00:00-05:00"),
    ];
    await writeFile(source, JSON.stringify(events));
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const repository = new SqliteRepository(target, { applyRetention: false });
    await repository.init();
    expect(await repository.counts()).toMatchObject({ total: 2 });
    expect(log).toHaveBeenCalledWith("import initial 2 événements depuis le JSON");
    expect(JSON.parse(await readFile(source, "utf8"))).toEqual(events);
    repository.close();
    log.mockRestore();
  });

  it("annule entièrement un import initial invalide et remonte une erreur explicite", async () => {
    const source = await temporaryPath("intel-events.json");
    const target = path.join(path.dirname(source), "events.sqlite");
    await writeFile(source, JSON.stringify([
      fixtureEvent("ucdp:initial-valid", "ucdp", "2026-10-18T10:00:00Z"),
      fixtureEvent("ucdp:initial-invalid", "ucdp", "2026-10-18T11:00:00Z", { latitude: Number.NaN }),
    ]));
    const repository = new SqliteRepository(target, { applyRetention: false });
    await expect(repository.init()).rejects.toThrow("Import initial SQLite invalide");
    const inspection = new DatabaseSync(target, { readOnly: true });
    expect(inspection.prepare("SELECT COUNT(*) AS count FROM conflict_events").get()).toEqual({ count: 0 });
    inspection.close();
  });

  it("rend la main entre deux lots d'un gros upsert", async () => {
    const repository = new SqliteRepository(await temporaryPath("batches.sqlite"), { applyRetention: false });
    await repository.init();
    const events = Array.from({ length: SQLITE_UPSERT_BATCH_SIZE + 1 }, (_, index) =>
      fixtureEvent(`ucdp:batch-${index}`, "ucdp", "2026-10-18T10:00:00Z"));
    let yielded = false;
    setImmediate(() => { yielded = true; });
    expect(await repository.upsert(events)).toEqual({ inserted: events.length, updated: 0 });
    expect(yielded).toBe(true);
    repository.close();
  });

  it("ne purge que la presse GDELT et les détections FIRMS expirées", async () => {
    const repository = new SqliteRepository(await temporaryPath("retention.sqlite"), {
      now: () => NOW,
      gdeltRetentionDays: 30,
      firmsRetentionDays: 14,
    });
    await repository.init();
    await repository.upsert([
      fixtureEvent("gdelt:expired", "gdelt", "2026-09-17T11:59:59.000Z"),
      fixtureEvent("gdelt:kept", "gdelt", "2026-09-18T12:00:00.000Z"),
      fixtureEvent("firms:expired", "firms", "2026-10-04T11:59:59.000Z"),
      fixtureEvent("firms:kept", "firms", "2026-10-04T12:00:00.000Z"),
      fixtureEvent("gdelt:invalid-date", "gdelt", "date-invalide"),
      fixtureEvent("ucdp:old-media-type", "ucdp", "2020-01-01T00:00:00.000Z", { eventType: "Media signal" }),
      fixtureEvent("import:old-thermal-type", "import:csv", "2020-01-01T00:00:00.000Z", { eventType: "Thermal anomaly" }),
    ]);

    const ids = (await repository.query({ from: new Date(0), to: NOW })).map((event) => event.id).sort();
    expect(ids).toEqual([
      "firms:kept",
      "gdelt:kept",
      "import:old-thermal-type",
      "ucdp:old-media-type",
    ]);
    expect((await repository.byIds(["gdelt:invalid-date"])).map((event) => event.id))
      .toEqual(["gdelt:invalid-date"]);
    repository.close();
  });
});

describe("migration JSON vers SQLite", () => {
  it("est idempotente, vérifie l'intégrité et ne modifie pas la fixture source", async () => {
    const source = await temporaryPath("fixture.json");
    const target = path.join(path.dirname(source), "fixture.sqlite");
    const fixture = [
      fixtureEvent("ucdp:migration", "ucdp", "2026-08-31T00:00:00.000Z", { title: null }),
      fixtureEvent("gdelt:migration", "gdelt", "2026-10-18T08:00:00.000Z", { geoPrecision: "country" }),
      fixtureEvent("firms:migration", "firms", "2026-10-18T09:00:00.000Z"),
    ];
    await writeFile(source, JSON.stringify(fixture));
    const hashBefore = createHash("sha256").update(await readFile(source)).digest("hex");

    const first = await migrateJsonToSqlite(source, target);
    expect(first).toMatchObject({
      sourceRecords: 3,
      distinctSourceRecords: 3,
      before: 0,
      after: 3,
      inserted: 3,
      updated: 0,
      missing: 0,
      payloadMismatches: 0,
      sourceUnchanged: true,
      verified: true,
    });
    const second = await migrateJsonToSqlite(source, target);
    expect(second).toMatchObject({ before: 3, after: 3, inserted: 0, updated: 3, verified: true });
    expect(createHash("sha256").update(await readFile(source)).digest("hex")).toBe(hashBefore);
  });

  it("contrôle l'intégrité avant COMMIT et restaure la cible en cas d'échec", async () => {
    const source = await temporaryPath("fixture.json");
    const target = path.join(path.dirname(source), "fixture.sqlite");
    const original = fixtureEvent("ucdp:rollback", "ucdp", "2026-08-31T00:00:00Z", { title: "original" });
    await writeFile(source, JSON.stringify([original]));
    await migrateJsonToSqlite(source, target);

    const sabotage = new DatabaseSync(target);
    sabotage.exec(`
      CREATE TRIGGER corrupt_migrated_payload AFTER UPDATE ON conflict_events
      BEGIN
        UPDATE conflict_events SET payload = '{"tampered":true}' WHERE id = NEW.id;
      END;
    `);
    sabotage.close();
    await writeFile(source, JSON.stringify([{ ...original, title: "replacement" }]));

    await expect(migrateJsonToSqlite(source, target)).rejects.toThrow("Migration integrity verification failed");
    const inspection = new DatabaseSync(target, { readOnly: true });
    const stored = inspection.prepare("SELECT payload FROM conflict_events WHERE id = ?").get(original.id) as { payload: string };
    expect(JSON.parse(stored.payload)).toEqual(original);
    inspection.close();
  });
});

const proofSource = process.env.ORBITAL_SQLITE_PROOF_SOURCE;
describe.runIf(Boolean(proofSource))("preuve sur copie temporaire explicite", () => {
  it("compare LocalRepository et l'import initial SQLite sur 24 h, 7 j et 30 j", async () => {
    const source = proofSource as string;
    const target = path.join(path.dirname(source), "initial-import.sqlite");
    const raw = JSON.parse(await readFile(source, "utf8")) as ConflictEvent[];
    const validTimes = raw.map((event) => Date.parse(event.eventDate)).filter(Number.isFinite);
    const to = new Date(Math.max(...validTimes));
    const local = new LocalRepository(source);
    const sqlite = new SqliteRepository(target, { applyRetention: false, initialJsonPath: source });
    await local.init();
    await sqlite.init();
    const windows: Record<string, { local: number; sqlite: number }> = {};
    for (const [label, duration] of [["24h", 86_400_000], ["7j", 7 * 86_400_000], ["30j", 30 * 86_400_000]] as const) {
      const query = { from: new Date(to.getTime() - duration), to };
      windows[label] = {
        local: (await local.query(query)).length,
        sqlite: (await sqlite.query(query)).length,
      };
      expect(windows[label].sqlite).toBe(windows[label].local);
    }
    const counts = { source: raw.length, sqlite: (await sqlite.counts()).total };
    expect(counts.sqlite).toBe(counts.source);
    console.info("preuve SQLite /tmp", JSON.stringify({ to: to.toISOString(), counts, windows }));
    sqlite.close();
  });
});
