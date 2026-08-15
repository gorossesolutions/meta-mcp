import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveCredentials } from "../../client/auth.js";
import { graphGet } from "../../client/meta-api.js";
import { accountSelectorSchema, jsonResult, withErrorHandling } from "../shared.js";
import type { GraphApiListResponse } from "../../types/index.js";

const AD_FIELDS =
  "id,name,status,effective_status,adset_id,campaign_id,created_time,updated_time,creative{id,name,thumbnail_url,body,title,image_url,video_id,object_story_spec}";

export interface GetAdsInput {
  client_id?: string;
  account_id?: string;
  adset_id?: string;
  campaign_id?: string;
  status?: Array<"ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED">;
  limit?: number;
}

export async function getAds(input: GetAdsInput): Promise<Record<string, unknown>[]> {
  const creds = resolveCredentials(input.client_id);
  const parentId = input.adset_id ?? input.campaign_id ?? input.account_id ?? creds.adAccountId;
  if (!parentId) {
    throw new Error(
      "Provide adset_id, campaign_id, account_id, or a client_id with a configured ad_account_id in accounts.config.json",
    );
  }
  const response = await graphGet<GraphApiListResponse<Record<string, unknown>>>(
    `${parentId}/ads`,
    {
      fields: AD_FIELDS,
      limit: input.limit ?? 25,
      filtering: input.status
        ? JSON.stringify([{ field: "status", operator: "IN", value: input.status }])
        : undefined,
    },
    creds.accessToken,
  );
  return response.data;
}

export function registerGetAdsTool(server: McpServer): void {
  server.registerTool(
    "get_ads",
    {
      title: "Get ads",
      description:
        "Lists ads with their associated creative. Scope to a single ad set (adset_id), campaign (campaign_id), or list all ads in an ad account.",
      inputSchema: {
        ...accountSelectorSchema,
        adset_id: z.string().optional().describe("Restrict results to ads under this ad set."),
        campaign_id: z.string().optional().describe("Restrict results to ads under this campaign."),
        status: z
          .array(z.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]))
          .optional()
          .describe("Filter to only these ad statuses."),
        limit: z.number().int().min(1).max(500).optional().describe("Max ads to return (default 25)."),
      },
    },
    withErrorHandling(async (input) => jsonResult(await getAds(input))),
  );
}
