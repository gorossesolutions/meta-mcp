#!/usr/bin/env node
// Applies db/migrations/*.sql, in filename order, tracking what has already
// run in a _migrations table so re-runs are no-ops for already-applied
// files. Each file also runs inside its own transaction, so a failure
// partway through one file rolls that file back cleanly instead of leaving
// half-applied schema changes.
//
// Uses @neondatabase/serverless's Client (WebSocket-backed), not the plain
// neon() HTTP tagged-template client: migrations need multi-statement SQL
// files and real transactions (BEGIN/COMMIT), which the stateless HTTP
// driver doesn't support the way a persistent connection does.
//
// Usage: npm run db:migrate  (reads DATABASE_URL from .env)

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env and fill in your Neon connection string.");
    process.exit(1);
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migration files found in db/migrations/.");
    return;
  }

  const client = new Client(connectionString);
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ filename: string }>("SELECT filename FROM _migrations");
    const applied = new Set(rows.map((r) => r.filename));

    let appliedCount = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip   ${file} (already applied)`);
        continue;
      }

      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
      console.log(`apply  ${file}`);

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        appliedCount += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Migration ${file} failed and was rolled back: ${message}`, { cause: error });
      }
    }

    console.log(`\nDone. ${appliedCount} migration(s) applied, ${files.length - appliedCount} already up to date.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
