#!/usr/bin/env node
// One-time, manual teardown: drops the `authenticated` role and every
// privilege granted to it, so Neon's "Enable Data API" button can create
// its own `authenticated` role without hitting "role already exists".
//
// Touches ONLY the role object and its grants. Never touches: tables,
// rows, RLS policies (none of them reference `authenticated` by name —
// see db/README.md), the `app` schema/functions, or the `svc_sync` role.
//
// Safe by default: without --yes, only PREVIEWS what would be dropped
// (introspected live from pg_catalog, not a hardcoded guess) and changes
// nothing. Run again with --yes to actually execute.
//
// Usage:
//   npx tsx db/teardown-authenticated-role.ts            # preview only
//   npx tsx db/teardown-authenticated-role.ts --yes       # actually drop it
//
// Requires DATABASE_URL (the Neon project OWNER connection string) — this
// is a schema/role-admin operation, svc_sync doesn't have the privileges
// for it and shouldn't be used here.

import { Client, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const ROLE = "authenticated";

async function main() {
  const execute = process.argv.includes("--yes");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (must be the Neon project OWNER connection string).");
  }

  const client = new Client(connectionString);
  await client.connect();

  const { rows: roleRows } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ROLE]);
  if (roleRows.length === 0) {
    console.log(`Role "${ROLE}" does not exist — nothing to tear down. Safe to click "Enable Data API" now.`);
    await client.end();
    return;
  }

  const tableGrants = await client.query<{ table_schema: string; table_name: string; privilege_type: string }>(
    `SELECT table_schema, table_name, privilege_type FROM information_schema.role_table_grants
     WHERE grantee = $1 ORDER BY table_schema, table_name, privilege_type`,
    [ROLE],
  );
  // information_schema has no view for schema-level privileges (not a
  // SQL-standard object type) — query pg_catalog directly instead, or the
  // preview would silently miss "GRANT USAGE ON SCHEMA app" (confirmed
  // during this session: information_schema.role_usage_grants reports 0
  // rows for it even though the grant is real and DROP OWNED BY does
  // revoke it). Checked per-schema (not scanned broadly) to avoid a false
  // positive from schemas where PUBLIC already has USAGE (e.g. "public")
  // — has_schema_privilege() reports effective privilege including
  // through PUBLIC, which isn't the same as a grant held directly by this
  // role and wouldn't be touched by DROP OWNED BY.
  const schemaGrants: { nspname: string }[] = [];
  for (const schema of ["app"]) {
    const { rows } = await client.query<{ direct: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_namespace n
         CROSS JOIN LATERAL aclexplode(n.nspacl) AS acl
         JOIN pg_roles r ON r.oid = acl.grantee
         WHERE n.nspname = $1 AND r.rolname = $2 AND acl.privilege_type = 'USAGE'
       ) AS direct`,
      [schema, ROLE],
    );
    if (rows[0]?.direct) schemaGrants.push({ nspname: schema });
  }
  const routineGrants = await client.query<{ routine_schema: string; routine_name: string; privilege_type: string }>(
    `SELECT routine_schema, routine_name, privilege_type FROM information_schema.role_routine_grants
     WHERE grantee = $1 ORDER BY routine_schema, routine_name`,
    [ROLE],
  );

  console.log(`\nRole "${ROLE}" exists. This is EXACTLY what ${execute ? "will now be" : "would be"} removed:\n`);

  console.log(`Table/view privileges (${tableGrants.rows.length}):`);
  for (const g of tableGrants.rows) console.log(`  REVOKE ${g.privilege_type} ON ${g.table_schema}.${g.table_name}`);

  console.log(`\nSchema USAGE privileges (${schemaGrants.length}):`);
  for (const g of schemaGrants) console.log(`  REVOKE USAGE ON SCHEMA ${g.nspname}`);

  console.log(`\nFunction EXECUTE privileges (${routineGrants.rows.length}):`);
  for (const g of routineGrants.rows) console.log(`  REVOKE ${g.privilege_type} ON FUNCTION ${g.routine_schema}.${g.routine_name}`);

  console.log(`\nThen: DROP ROLE ${ROLE};`);
  console.log(
    `\nNOT touched: any table's rows/columns, any RLS policy (none reference "${ROLE}" by name), the app schema/functions, or the svc_sync role.`,
  );

  if (!execute) {
    console.log(`\nPreview only — nothing was changed. Re-run with --yes to execute.`);
    await client.end();
    return;
  }

  console.log(`\nExecuting...`);
  await client.query(`DROP OWNED BY ${ROLE}`);
  await client.query(`DROP ROLE ${ROLE}`);
  console.log(`Done. Role "${ROLE}" and all its grants are gone. You can now click "Enable Data API" in the Neon console.`);

  await client.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
