// Connects to Neon as the sync job and immediately enforces the svc_sync
// guard — no query runs before that check passes.

import { Client, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { assertConnectedAsSyncRole } from "./guard.js";

neonConfig.webSocketConstructor = ws;

export async function connectAsSyncRole(): Promise<Client> {
  const connectionString = process.env.DATABASE_URL_SYNC;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL_SYNC is not set. See .env.example and db/README.md — this must be the svc_sync role's connection string, never DATABASE_URL.",
    );
  }

  const client = new Client(connectionString);
  await client.connect();

  try {
    await assertConnectedAsSyncRole(client);
  } catch (error) {
    await client.end();
    throw error;
  }

  return client;
}
