import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { graphPost } from "../../client/meta-api.js";
import { accountSelectorSchema, confirmField, previewResult, executedResult, resolveAccount, withErrorHandling } from "../shared.js";

const OBJECTIVES = [
  "OUTCOME_AWARENESS",
  "OUTCOME_TRAFFIC",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
  "OUTCOME_APP_PROMOTION",
] as const;

export function registerCreateCampaignTool(server: McpServer): void {
  server.registerTool(
    "create_campaign",
    {
      title: "Create campaign",
      description:
        "Creates a new campaign. Always created in PAUSED status — this is non-negotiable, the tool never accepts or produces an ACTIVE campaign on creation. Always previews first — call again with confirm: true to execute.",
      inputSchema: {
        ...accountSelectorSchema,
        name: z.string().describe("Campaign name."),
        objective: z.enum(OBJECTIVES).describe("Campaign objective."),
        special_ad_categories: z
          .array(z.string())
          .optional()
          .describe('Meta special ad categories, e.g. ["HOUSING", "EMPLOYMENT", "CREDIT"]. Defaults to none.'),
        buying_type: z.string().optional().describe('Defaults to "AUCTION".'),
        ...confirmField,
      },
    },
    withErrorHandling(async ({ client_id, account_id, name, objective, special_ad_categories, buying_type, confirm }) => {
      const { accessToken, adAccountId } = resolveAccount(client_id, account_id);

      const proposedChange = {
        name,
        objective,
        status: "PAUSED" as const,
        special_ad_categories: special_ad_categories ?? [],
        buying_type: buying_type ?? "AUCTION",
      };

      if (!confirm) {
        return previewResult({
          action: "create_campaign",
          target: { ad_account_id: adAccountId },
          current_state: { exists: false },
          proposed_change: proposedChange,
          warnings: ["Campaign will be created in PAUSED status — you'll need a separate update_campaign_status call to activate it."],
        });
      }

      const result = await graphPost<{ id?: string }>(
        `${adAccountId}/campaigns`,
        {
          name,
          objective,
          status: "PAUSED",
          special_ad_categories: JSON.stringify(special_ad_categories ?? []),
          buying_type: buying_type ?? "AUCTION",
        },
        accessToken,
      );
      return executedResult("create_campaign", { ad_account_id: adAccountId }, result);
    }),
  );
}
