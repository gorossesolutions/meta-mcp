import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveCredentials } from "../../client/auth.js";
import { graphGet } from "../../client/meta-api.js";
import { accountSelectorSchema, jsonResult, withErrorHandling } from "../shared.js";
import type { GraphApiListResponse } from "../../types/index.js";

const ADSET_FIELDS =
  "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,billing_event,optimization_goal,bid_amount,bid_strategy,targeting,start_time,end_time,created_time,updated_time,learning_stage_info";

export interface GetAdsetsInput {
  client_id?: string;
  account_id?: string;
  campaign_id?: string;
  status?: Array<"ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED">;
  limit?: number;
}

/**
 * Meta only populates status/conversions/last_sig_edit_ts while the ad set is
 * actually delivering (effective_status ACTIVE) — otherwise the raw field
 * comes back with just attribution_windows, or is absent entirely (e.g. for
 * Dynamic Creative Optimization ad sets). We normalize that into a flat,
 * always-present shape rather than leaking Meta's raw nesting/unix timestamp.
 */
interface LearningPhase {
  status: string | null;
  conversions: number | null;
  last_significant_edit: string | null;
  attribution_windows: string[] | null;
}

function normalizeLearningStage(raw: unknown): LearningPhase | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const lastSigEditTs = typeof r.last_sig_edit_ts === "number" ? r.last_sig_edit_ts : undefined;
  return {
    status: typeof r.status === "string" ? r.status : null,
    conversions: typeof r.conversions === "number" ? r.conversions : null,
    last_significant_edit: lastSigEditTs ? new Date(lastSigEditTs * 1000).toISOString() : null,
    attribution_windows: Array.isArray(r.attribution_windows) ? (r.attribution_windows as string[]) : null,
  };
}

export async function getAdsets(input: GetAdsetsInput): Promise<Record<string, unknown>[]> {
  const creds = resolveCredentials(input.client_id);
  const parentId = input.campaign_id ?? input.account_id ?? creds.adAccountId;
  if (!parentId) {
    throw new Error(
      "Provide campaign_id, account_id, or a client_id with a configured ad_account_id in accounts.config.json",
    );
  }
  const response = await graphGet<GraphApiListResponse<Record<string, unknown>>>(
    `${parentId}/adsets`,
    {
      fields: ADSET_FIELDS,
      limit: input.limit ?? 25,
      filtering: input.status
        ? JSON.stringify([{ field: "status", operator: "IN", value: input.status }])
        : undefined,
    },
    creds.accessToken,
  );
  return response.data.map(({ learning_stage_info, ...adset }) => ({
    ...adset,
    learning_phase: normalizeLearningStage(learning_stage_info),
  }));
}

export function registerGetAdsetsTool(server: McpServer): void {
  server.registerTool(
    "get_adsets",
    {
      title: "Get ad sets",
      description:
        "Lists ad sets, with a summary of budget, bidding, targeting, timestamps and learning phase (learning_phase.status: LEARNING/SUCCESS/FAIL, only populated while the ad set is actively delivering). Scope to a single campaign with campaign_id, or list all ad sets in an ad account.",
      inputSchema: {
        ...accountSelectorSchema,
        campaign_id: z.string().optional().describe("Restrict results to ad sets under this campaign."),
        status: z
          .array(z.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]))
          .optional()
          .describe("Filter to only these ad set statuses."),
        limit: z.number().int().min(1).max(500).optional().describe("Max ad sets to return (default 25)."),
      },
    },
    withErrorHandling(async (input) => jsonResult(await getAdsets(input))),
  );
}
