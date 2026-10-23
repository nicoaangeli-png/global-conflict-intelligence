#!/usr/bin/env node
/** Explicit schema preparation, separate from data transfer and server startup. */
const { createHash } = require("node:crypto");
const { Pool } = require("pg");

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const index = args.indexOf("--expect-database");
  const expectedDatabase = index >= 0 ? args[index + 1] : null;
  if (!expectedDatabase || args.some((arg, position) =>
    arg !== "--apply" && arg !== "--expect-database" && position !== index + 1)) {
    throw new Error("Use --expect-database NAME; add --apply to change the destination schema");
  }
  const url = process.env.ORBITAL_MIGRATION_DATABASE_URL?.trim();
  if (!url) throw new Error("ORBITAL_MIGRATION_DATABASE_URL is required");
  const destination = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5_000,
    application_name: "orbital-schema-preparation" });
  try {
    const target = await pool.query("SELECT current_database() AS name");
    if (target.rows[0].name !== expectedDatabase) throw new Error("Destination database name differs from --expect-database");
    let result;
    if (apply) {
      // Same versioned migrations and transactional advisory lock as PgRepository.init().
      const { migratePostgres } = require("../src/server/migrations/postgres.ts");
      result = await migratePostgres(pool);
    } else {
      const exists = await pool.query("SELECT to_regclass('orbital_schema_migrations') AS table_name");
      const version = exists.rows[0].table_name
        ? Number((await pool.query("SELECT MAX(version) AS v FROM orbital_schema_migrations")).rows[0].v ?? 0)
        : 0;
      result = { from: version, to: version, applied: [] };
    }
    console.log(JSON.stringify({ status: "ok", mode: apply ? "apply" : "dry-run", destination, schema: result }));
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  // Never include driver errors: connection strings and SQL details may be embedded.
  console.error(JSON.stringify({ status: "failed", error: "Schema preparation failed; verify target, permissions and version privately" }));
  process.exitCode = 1;
});
