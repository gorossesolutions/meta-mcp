import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveCredentials } from "../../client/auth.js";
import { graphGet } from "../../client/meta-api.js";
import { accountSelectorSchema, jsonResult, withErrorHandling } from "../shared.js";
import type { GraphApiListResponse } from "../../types/index.js";

const CREATIVE_FIELDS =
  "id,name,status,body,title,image_url,video_id,thumbnail_url,call_to_action_type,object_story_spec,object_type";

export interface GetCreativesInput {
  client_id?: string;
  account_id?: string;
  creative_id?: string;
  ad_id?: string;
  limit?: number;
}

export async function getCreatives(
  input: GetCreativesInput,
): Promise<Record<string, unknown> | Record<string, unknown>[]> {
  const creds = resolveCredentials(input.client_id);

  if (input.creative_id) {
    return graphGet<Record<string, unknown>>(input.creative_id, { fields: CREATIVE_FIELDS }, creds.accessToken);
  }

  if (input.ad_id) {
    const ad = await graphGet<Record<string, unknown>>(
      input.ad_id,
      { fields: `creative{${CREATIVE_FIELDS}}` },
      creds.accessToken,
    );
    return (ad.creative as Record<string, unknown> | undefined) ?? ad;
  }

  const adAccountId = input.account_id ?? creds.adAccountId;
  if (!adAccountId) {
    throw new Error(
      "Provide creative_id, ad_id, account_id, or a client_id with a configured ad_account_id in accounts.config.json",
    );
  }
  const response = await graphGet<GraphApiListResponse<Record<string, unknown>>>(
    `${adAccountId}/adcreatives`,
    { fields: CREATIVE_FIELDS, limit: input.limit ?? 25 },
    creds.accessToken,
  );
  return response.data;
}

export function registerGetCreativesTool(server: McpServer): void {
  server.registerTool(
    "get_creatives",
    {
      title: "Get creatives",
      description:
        "Fetches creative assets (image/video, copy, hook, CTA). Pass creative_id or ad_id for a single creative, or omit both to list all creatives in an ad account.",
      inputSchema: {
        ...accountSelectorSchema,
        creative_id: z.string().optional().describe("Fetch this specific creative."),
        ad_id: z.string().optional().describe("Fetch the creative attached to this ad."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Max creatives to return when listing an account (default 25)."),
      },
    },
    withErrorHandling(async (input) => jsonResult(await getCreatives(input))),
  );
}
