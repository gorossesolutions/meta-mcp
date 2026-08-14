// Meta OAuth 2.0 token handling: resolving the right token for a client,
// and exchanging a short-lived user token for a long-lived one.
//
// System User tokens (Business Manager > System Users) do not expire and
// are the recommended path for production/automated use — no refresh logic
// needed for those, they're just set as META_ACCESS_TOKEN or a per-client
// access_token_env_var.

import { findClientAccount } from "../config/accounts.js";
import type { ResolvedCredentials } from "../types/index.js";
import { GRAPH_API_BASE_URL, DEFAULT_API_VERSION } from "./meta-api.js";

const ACCOUNTS_CONFIG_PATH = process.env.ACCOUNTS_CONFIG_PATH ?? "./accounts.config.json";

/**
 * Resolves the access token and (if known) ad account id to use for a call.
 *
 * - With a client_id: looks up the client in accounts.config.json, reads its
 *   token from the env var it points to (falling back to META_ACCESS_TOKEN
 *   if that env var isn't set), and returns its ad_account_id.
 * - Without a client_id: uses META_ACCESS_TOKEN directly; the caller must
 *   supply an explicit ad_account_id.
 */
export function resolveCredentials(clientId?: string): ResolvedCredentials {
  if (clientId) {
    const entry = findClientAccount(clientId, ACCOUNTS_CONFIG_PATH);
    const accessToken = process.env[entry.access_token_env_var] ?? process.env.META_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error(
        `No access token found for client "${clientId}": set ${entry.access_token_env_var} or META_ACCESS_TOKEN`,
      );
    }
    return { accessToken, adAccountId: entry.ad_account_id, clientId };
  }

  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("META_ACCESS_TOKEN is not set and no client_id was provided");
  }
  return { accessToken };
}

/**
 * Exchanges a short-lived user access token for a long-lived one (~60 days).
 * Requires META_APP_ID / META_APP_SECRET to be set.
 */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{
  accessToken: string;
  expiresInSeconds?: number;
}> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("META_APP_ID and META_APP_SECRET must be set to exchange tokens");
  }

  const version = process.env.META_API_VERSION ?? DEFAULT_API_VERSION;
  const url = new URL(`${GRAPH_API_BASE_URL}/${version}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortLivedToken);

  const response = await fetch(url);
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message: string };
  };

  if (!response.ok || !body.access_token) {
    throw new Error(`Token exchange failed: ${body.error?.message ?? response.statusText}`);
  }

  return { accessToken: body.access_token, expiresInSeconds: body.expires_in };
}
