import type { ConflictEvent } from "@/types/conflict";
import { createRepository } from "@/server/repository";
import { SqliteRepository } from "@/server/sqliteRepository";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

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
      "conflict_events_dataset_date_idx",
      "conflict_events_type_date_idx",
      "conflict_events_country_iso3_date_idx",
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
});
