import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migratePostgres, POSTGRES_SCHEMA_VERSION, SCHEMA_SQL } from "@/server/migrations/postgres";
import { PgRepository } from "@/server/repository";
import type { ConflictEvent } from "@/types/conflict";

/**
 * Tests sur un vrai PostgreSQL, activés par ORBITAL_TEST_DATABASE_URL (base jetable :
 * le schéma public y est réinitialisé). Ignorés sinon (CI sans base).
 */
const url = process.env.ORBITAL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

function event(id: string, extra: Partial<ConflictEvent> & Record<string, unknown> = {}): ConflictEvent {
  return {
    id, sourceDataset: "ucdp", latitude: 15.5, longitude: 32.5, country: "Sudan", region: "Khartoum", locality: "Omdurman",
    eventType: "Battles", subEventType: "", actors: ["A", "B"], fatalities: 3, source: "UCDP", sourceUrl: "https://ucdp.uu.se/",
    confidence: "VERIFIED", eventDate: new Date(Date.now() - 86_400_000).toISOString(), updatedAt: new Date().toISOString(), ...extra,
  } as ConflictEvent;
}

suite("migrations PostgreSQL (base réelle)", () => {
  let pool: Pool;
  const reset = () => pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
  });
  afterAll(async () => {
    await pool.end();
  });

  it("base neuve : toutes les migrations, une fois ; démarrages simultanés sans double application", async () => {
    await reset();
    const reports = await Promise.all([migratePostgres(pool), migratePostgres(pool), migratePostgres(pool)]);
    expect(reports.flatMap((report) => report.applied).sort()).toEqual([1, 2, 3, 4, 5]);
    const rows = await pool.query("SELECT version FROM orbital_schema_migrations ORDER BY version");
    expect(rows.rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5]);
    expect(await migratePostgres(pool)).toEqual({ from: POSTGRES_SCHEMA_VERSION, to: POSTGRES_SCHEMA_VERSION, applied: [] });
  });

  it("base historique (schéma implicite, sans table de migrations) : migrée sans perte, ancienne ligne lisible", async () => {
    await reset();
    await pool.query(SCHEMA_SQL);
    await pool.query(
      `INSERT INTO conflict_events (id, source_dataset, latitude, longitude, country, event_type, confidence, event_date)
       VALUES ('ancien', 'ucdp', 1, 2, 'Sudan', 'Battles', 'VERIFIED', now() - interval '1 day')`,
    );
    expect(await migratePostgres(pool)).toMatchObject({ from: 0, applied: [1, 2, 3, 4, 5] });
    const repository = new PgRepository(url!);
    await repository.init();
    const events = await repository.query({ from: new Date(Date.now() - 7 * 86_400_000), to: new Date() });
    expect(events.map((e) => e.id)).toEqual(["ancien"]);
    expect(events[0]).toMatchObject({ country: "Sudan", eventType: "Battles" });
    await repository.clear();
    await (repository as unknown as { pool: Pool }).pool.end();
  });

  it("JSON complet conservé (champs additifs), filtre pays par nom ou ISO3, rétention GDELT", async () => {
    await reset();
    const repository = new PgRepository(url!);
    await repository.init();
    expect(repository.diagnostics()).toMatchObject({ schemaVersion: POSTGRES_SCHEMA_VERSION });
    await repository.upsert([
      event("ucdp-1", { countryIso3: "SDN", geoPrecision: "city", title: "Combats (fixture)" }),
      event("gdelt-vieux", { sourceDataset: "gdelt", confidence: "MEDIA_SIGNAL", eventDate: new Date(Date.now() - 40 * 86_400_000).toISOString() }),
    ]);
    const range = { from: new Date(Date.now() - 60 * 86_400_000), to: new Date() };
    const all = await repository.query(range);
    expect(all.map((e) => e.id)).toEqual(["ucdp-1"]); // GDELT de 40 jours purgé (rétention 30 j)
    expect(all[0]).toMatchObject({ geoPrecision: "city", title: "Combats (fixture)", actors: ["A", "B"] });
    expect((await repository.query({ ...range, countries: ["SDN"] })).map((e) => e.id)).toEqual(["ucdp-1"]);
    expect((await repository.query({ ...range, countries: ["Sudan"] })).map((e) => e.id)).toEqual(["ucdp-1"]);
    await (repository as unknown as { pool: Pool }).pool.end();
  });

  it("refuse une base au schéma plus récent", async () => {
    await pool.query("INSERT INTO orbital_schema_migrations (version, name) VALUES ($1, 'future')", [POSTGRES_SCHEMA_VERSION + 1]);
    await expect(migratePostgres(pool)).rejects.toThrow(/plus récent/);
  });
});
