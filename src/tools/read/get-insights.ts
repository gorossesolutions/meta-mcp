import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveCredentials } from "../../client/auth.js";
import { graphGet } from "../../client/meta-api.js";
import { accountSelectorSchema, jsonResult, withErrorHandling } from "../shared.js";
import type { GraphApiListResponse } from "../../types/index.js";

const INSIGHTS_FIELDS =
  "date_start,date_stop,impressions,reach,frequency,clicks,ctr,cpc,cpm,spend,actions,action_values,purchase_roas,inline_link_clicks,cost_per_action_type";

// Ad relevance diagnostics: only meaningful at ad level (Meta returns "UNKNOWN"
// rather than erroring at other levels, but that's just noise there) and only
// populated once an ad clears ~500 impressions — see README for details.
const AD_QUALITY_RANKING_FIELDS = "quality_ranking,engagement_rate_ranking,conversion_rate_ranking";

const DATE_PRESETS = [
  "today",
  "yesterday",
  "last_7d",
  "last_14d",
  "last_28d",
  "last_30d",
  "last_90d",
  "this_month",
  "last_month",
  "maximum",
] as const;

// Exported so callers outside this module (db/sync) can validate/type a
// single breakdown dimension against the same list without duplicating it.
export const BREAKDOWNS = [
  "age",
  "gender",
  "publisher_platform",
  "platform_position",
  "impression_device",
  "device_platform",
  "region",
  "country",
] as const;

export type BreakdownDimension = (typeof BREAKDOWNS)[number];

export interface GetInsightsInput {
  client_id?: string;
  account_id?: string;
  object_id?: string;
  level?: "account" | "campaign" | "adset" | "ad";
  date_preset?: (typeof DATE_PRESETS)[number];
  since?: string;
  until?: string;
  breakdowns?: Array<(typeof BREAKDOWNS)[number]>;
  limit?: number;
}

export async function getInsights(input: GetInsightsInput): Promise<Record<string, unknown>[]> {
  const creds = resolveCredentials(input.client_id);
  const targetId = input.object_id ?? input.account_id ?? creds.adAccountId;
  if (!targetId) {
    throw new Error(
      "Provide object_id, account_id, or a client_id with a configured ad_account_id in accounts.config.json",
    );
  }

  const timeRange = input.since && input.until ? { since: input.since, until: input.until } : undefined;
  const fields =
    input.level === "ad" ? `${INSIGHTS_FIELDS},${AD_QUALITY_RANKING_FIELDS}` : INSIGHTS_FIELDS;

  const response = await graphGet<GraphApiListResponse<Record<string, unknown>>>(
    `${targetId}/insights`,
    {
      fields,
      level: input.level,
      date_preset: timeRange ? undefined : (input.date_preset ?? "last_30d"),
      time_range: timeRange ? JSON.stringify(timeRange) : undefined,
      breakdowns: input.breakdowns?.join(","),
      limit: input.limit ?? 100,
    },
    creds.accessToken,
  );
  return response.data;
}

export function registerGetInsightsTool(server: McpServer): void {
  server.registerTool(
    "get_insights",
    {
      title: "Get insights",
      description:
        "Fetches performance metrics (impressions, reach, CTR, CPC, CPM, spend, ROAS, conversions, inline_link_clicks, cost_per_action_type) for an ad account, campaign, ad set or ad, with optional date range and breakdowns (age, gender, placement, device). Pass level: \"ad\" to also get Meta's relevance diagnostics (quality_ranking, engagement_rate_ranking, conversion_rate_ranking) — these return \"UNKNOWN\" below ~500 impressions.",
      inputSchema: {
        ...accountSelectorSchema,
        object_id: z
          .string()
          .optional()
          .describe("Campaign, ad set or ad id to scope insights to. Omit to get account-level insights."),
        level: z
          .enum(["account", "campaign", "adset", "ad"])
          .optional()
          .describe("Aggregation level. Inferred from object_id when omitted."),
        date_preset: z.enum(DATE_PRESETS).optional().describe('Relative date range, e.g. "last_30d" (default).'),
        since: z
          .string()
          .optional()
          .describe("Custom range start, YYYY-MM-DD. Overrides date_preset if set with until."),
        until: z
          .string()
          .optional()
          .describe("Custom range end, YYYY-MM-DD. Overrides date_preset if set with since."),
        breakdowns: z.array(z.enum(BREAKDOWNS)).optional().describe("Dimensions to break results down by."),
        limit: z.number().int().min(1).max(500).optional().describe("Max rows to return (default 100)."),
      },
    },
    withErrorHandling(async (input) => jsonResult(await getInsights(input))),
  );
}
