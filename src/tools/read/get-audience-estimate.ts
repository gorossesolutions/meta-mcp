import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { graphGet } from "../../client/meta-api.js";
import { accountSelectorSchema, jsonResult, resolveAccount, withErrorHandling } from "../shared.js";

export interface GetAudienceEstimateInput {
  client_id?: string;
  account_id?: string;
  targeting: Record<string, unknown>;
  optimization_goal?: string;
}

export async function getAudienceEstimate(input: GetAudienceEstimateInput): Promise<Record<string, unknown>> {
  const { accessToken, adAccountId } = resolveAccount(input.client_id, input.account_id);
  return graphGet<Record<string, unknown>>(
    `${adAccountId}/delivery_estimate`,
    {
      optimization_goal: input.optimization_goal ?? "REACH",
      targeting_spec: JSON.stringify(input.targeting),
    },
    accessToken,
  );
}

export function registerGetAudienceEstimateTool(server: McpServer): void {
  server.registerTool(
    "get_audience_estimate",
    {
      title: "Get audience estimate",
      description:
        "Estimates the reachable audience size for a given targeting spec (geo, age, gender, interests, custom/lookalike audiences, exclusions, ...) in an ad account, before creating a campaign.",
      inputSchema: {
        ...accountSelectorSchema,
        targeting: z
          .record(z.string(), z.unknown())
          .describe(
            'Meta targeting spec object, e.g. { "geo_locations": { "countries": ["FR"] }, "age_min": 25, "age_max": 45, "genders": [1] }',
          ),
        optimization_goal: z
          .string()
          .optional()
          .describe('Delivery optimization goal, e.g. "REACH", "LINK_CLICKS", "CONVERSIONS" (default "REACH").'),
      },
    },
    withErrorHandling(async (input) => jsonResult(await getAudienceEstimate(input))),
  );
}
