// Helpers shared by every MCP tool: resolving which ad account/token to
// call the Graph API with, and formatting results/errors consistently.

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { resolveCredentials } from "../client/auth.js";
import { MetaApiError } from "../client/meta-api.js";

/** Common input fields for tools that operate against a single ad account. */
export const accountSelectorSchema = {
  client_id: z
    .string()
    .optional()
    .describe(
      "Client identifier from accounts.config.json. Resolves the ad account and token automatically. Omit to use account_id + the default META_ACCESS_TOKEN instead.",
    ),
  account_id: z
    .string()
    .optional()
    .describe(
      'Ad account id, e.g. "act_1234567890". Required if client_id is omitted or its config entry has no ad_account_id.',
    ),
};

export function resolveAccount(clientId?: string, accountIdOverride?: string) {
  const creds = resolveCredentials(clientId);
  const adAccountId = accountIdOverride ?? creds.adAccountId;
  if (!adAccountId) {
    throw new Error(
      "No ad account could be resolved: pass account_id explicitly, or configure one for this client_id in accounts.config.json",
    );
  }
  return { accessToken: creds.accessToken, adAccountId };
}

export function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function errorResult(error: unknown): CallToolResult {
  if (error instanceof MetaApiError) {
    return {
      content: [
        {
          type: "text",
          text: `Meta API error: ${error.message}${error.fbtraceId ? ` (fbtrace_id: ${error.fbtraceId})` : ""}`,
        },
      ],
      isError: true,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

/** Wraps a tool handler so thrown errors become a clean MCP error result instead of crashing the server. */
export function withErrorHandling<Args extends unknown[]>(
  fn: (...args: Args) => Promise<CallToolResult>,
): (...args: Args) => Promise<CallToolResult> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (error) {
      return errorResult(error);
    }
  };
}
