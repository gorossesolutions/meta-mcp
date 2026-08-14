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

// --- Write-tool confirmation gate ---------------------------------------
//
// Every write tool must never mutate anything on its first call. It always
// computes a preview (current state -> proposed change) and only performs
// the Graph API write once the caller explicitly passes confirm: true.
// This is non-negotiable: see the project's security rule — no silent
// execution of write actions, ever.

export const confirmField = {
  confirm: z
    .boolean()
    .optional()
    .describe(
      "Must be true to actually execute this action. Omit or pass false to get a preview (current state, proposed change, computed deltas) without making any changes.",
    ),
};

export interface WritePreview {
  action: string;
  target: Record<string, unknown>;
  current_state: Record<string, unknown>;
  proposed_change: Record<string, unknown>;
  warnings?: string[];
}

export function previewResult(preview: WritePreview): CallToolResult {
  return jsonResult({
    status: "preview_only",
    message: "No changes were made. Review this preview and call the tool again with confirm: true to execute.",
    ...preview,
  });
}

export function executedResult(action: string, target: Record<string, unknown>, result: unknown): CallToolResult {
  return jsonResult({ status: "executed", action, target, result });
}

const BUDGET_CHANGE_WARNING_THRESHOLD_PERCENT = Number(
  process.env.BUDGET_CHANGE_CONFIRMATION_THRESHOLD_PERCENT ?? "20",
);

/** Percent change from current to proposed budget (in the account's minor currency unit), rounded to 1 decimal. */
export function budgetDeltaPercent(currentMinorUnits: number, proposedMinorUnits: number): number | null {
  if (currentMinorUnits === 0) return null;
  return Math.round(((proposedMinorUnits - currentMinorUnits) / currentMinorUnits) * 1000) / 10;
}

export function budgetChangeWarnings(deltaPercent: number | null): string[] {
  if (deltaPercent === null) return [];
  if (Math.abs(deltaPercent) < BUDGET_CHANGE_WARNING_THRESHOLD_PERCENT) return [];
  const direction = deltaPercent > 0 ? "increase" : "decrease";
  return [
    `This is a ${Math.abs(deltaPercent)}% budget ${direction}, above the configured ${BUDGET_CHANGE_WARNING_THRESHOLD_PERCENT}% threshold — double-check before confirming.`,
  ];
}
