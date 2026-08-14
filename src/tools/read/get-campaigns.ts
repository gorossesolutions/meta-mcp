import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { graphGet } from "../../client/meta-api.js";
import { accountSelectorSchema, jsonResult, resolveAccount, withErrorHandling } from "../shared.js";
import type { GraphApiListResponse } from "../../types/index.js";

const CAMPAIGN_FIELDS =
  "id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time,updated_time";

export interface GetCampaignsInput {
  client_id?: string;
  account_id?: string;
  status?: Array<"ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED">;
  limit?: number;
}

export async function getCampaigns(input: GetCampaignsInput): Promise<Record<string, unknown>[]> {
  const { accessToken, adAccountId } = resolveAccount(input.client_id, input.account_id);
  const response = await graphGet<GraphApiListResponse<Record<string, unknown>>>(
    `${adAccountId}/campaigns`,
    {
      fields: CAMPAIGN_FIELDS,
      limit: input.limit ?? 25,
      filtering: input.status
        ? JSON.stringify([{ field: "status", operator: "IN", value: input.status }])
        : undefined,
    },
    accessToken,
  );
  return response.data;
}

export function registerGetCampaignsTool(server: McpServer): void {
  server.registerTool(
    "get_campaigns",
    {
      title: "Get campaigns",
      description: "Lists campaigns for an ad account, with status, objective and budget.",
      inputSchema: {
        ...accountSelectorSchema,
        status: z
          .array(z.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]))
          .optional()
          .describe("Filter to only these campaign statuses."),
        limit: z.number().int().min(1).max(500).optional().describe("Max campaigns to return (default 25)."),
      },
    },
    withErrorHandling(async (input) => jsonResult(await getCampaigns(input))),
  );
}
