// Security guard: the sync job must never run with the Neon project owner's
// connection string. The owner role carries BYPASSRLS (confirmed in Neon's
// docs) — connecting as it would silently bypass every RLS policy in
// db/migrations/0008_rls.sql, with no error, no warning, nothing. A typo'd
// env var (DATABASE_URL instead of DATABASE_URL_SYNC) would look completely
// normal while quietly reading/writing across every client unrestricted.
//
// This checks current_user AS REPORTED BY POSTGRES ITSELF, not the
// connection string in code — the string can claim to be anything; only the
// server knows who it actually authenticated as. There is deliberately no
// flag, env var, or parameter to skip this check.

import type { Client } from "@neondatabase/serverless";

const REQUIRED_ROLE = "svc_sync";

export async function assertConnectedAsSyncRole(client: Client): Promise<void> {
  const { rows } = await client.query<{ current_user: string }>("SELECT current_user");
  const actualRole = rows[0]?.current_user;

  if (actualRole !== REQUIRED_ROLE) {
    throw new Error(
      `Refusing to run: connected to Postgres as "${actualRole}", not "${REQUIRED_ROLE}".\n` +
        `This almost always means DATABASE_URL (the Neon project owner, which carries BYPASSRLS) ` +
        `was used instead of DATABASE_URL_SYNC.\n` +
        `Fix your .env and retry — this check has no override, by design (see db/README.md).`,
    );
  }
}
