// Loads the multi-tenant client -> ad account / token mapping.
// See accounts.config.json.example for the expected file shape.

import { readFileSync } from "node:fs";
import type { AccountsConfig, ClientAccountConfig } from "../types/index.js";

// Short TTL rather than an unbounded cache: this file previously assumed a
// short-lived stdio process (load once, exit soon after). A long-running
// service (HTTP transport, a future sync job) can now add a client to
// accounts.config.json and have it picked up without a restart, just with
// a bounded delay instead of an instant reload on every call.
const CACHE_TTL_MS = 30_000;

let cachedConfig: AccountsConfig | undefined;
let cachedAt = 0;

function isClientAccountConfig(value: unknown): value is ClientAccountConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.client_id === "string" &&
    typeof v.ad_account_id === "string" &&
    typeof v.access_token_env_var === "string"
  );
}

export function loadAccountsConfig(path: string): AccountsConfig {
  if (cachedConfig && Date.now() - cachedAt < CACHE_TTL_MS) return cachedConfig;

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    // No multi-account config file — that's fine, callers fall back to the
    // default META_ACCESS_TOKEN / an explicit ad_account_id per call.
    cachedConfig = { clients: [] };
    cachedAt = Date.now();
    return cachedConfig;
  }

  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).clients)
  ) {
    throw new Error(`Invalid accounts config at ${path}: expected { "clients": [...] }`);
  }

  const clients = (parsed as { clients: unknown[] }).clients;
  for (const [i, entry] of clients.entries()) {
    if (!isClientAccountConfig(entry)) {
      throw new Error(
        `Invalid accounts config at ${path}: clients[${i}] must have client_id, ad_account_id and access_token_env_var`,
      );
    }
  }

  cachedConfig = { clients: clients as ClientAccountConfig[] };
  cachedAt = Date.now();
  return cachedConfig;
}

export function findClientAccount(clientId: string, path: string): ClientAccountConfig {
  const config = loadAccountsConfig(path);
  const entry = config.clients.find((c) => c.client_id === clientId);
  if (!entry) {
    const known = config.clients.map((c) => c.client_id).join(", ") || "(none configured)";
    throw new Error(`Unknown client_id "${clientId}". Configured clients: ${known}`);
  }
  return entry;
}

/** Reset the in-memory config cache. Exposed for tests. */
export function resetAccountsConfigCache(): void {
  cachedConfig = undefined;
  cachedAt = 0;
}
