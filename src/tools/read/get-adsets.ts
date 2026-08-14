import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveCredentials } from "../../client/auth.js";
import { graphGet } from "../../client/meta-api.js";
import { accountSelectorSchema, jsonResult, withErrorHandling } from "../shared.js";
import type { GraphApiListResponse } from "../../types/index.js";

const ADSET_FIELDS =
  "id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,billing_event,optimization_goal,bid_amount,bid_strategy,targeting,start_time,end_time";

export interface GetAdsetsInput {
  client_id?: string;
  account_id?: string;
  campaign_id?: string;
  status?: Array<"ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED">;
  limit?: number;
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
  return response.data;
}

export function registerGetAdsetsTool(server: McpServer): void {
  server.registerTool(
    "get_adsets",
    {
      title: "Get ad sets",
      description:
        "Lists ad sets, with a summary of budget, bidding and targeting. Scope to a single campaign with campaign_id, or list all ad sets in an ad account.",
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
