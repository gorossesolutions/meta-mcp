import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveCredentials } from "../../client/auth.js";
import { graphGet, graphPost } from "../../client/meta-api.js";
import { confirmField, previewResult, executedResult, withErrorHandling } from "../shared.js";

interface CampaignNameField {
  id: string;
  name?: string;
}

export function registerDuplicateCampaignTool(server: McpServer): void {
  server.registerTool(
    "duplicate_campaign",
    {
      title: "Duplicate campaign",
      description:
        "Duplicates a campaign (and, with deep_copy, its ad sets and ads) for A/B testing. The copy is always created PAUSED regardless of the source campaign's status. Always previews first — call again with confirm: true to execute.",
      inputSchema: {
        client_id: z
          .string()
          .optional()
          .describe("Client identifier from accounts.config.json. Omit to use the default META_ACCESS_TOKEN."),
        campaign_id: z.string().describe("Campaign id to duplicate."),
        name_suffix: z.string().optional().describe('Appended to the source name for the copy (default " - Copy").'),
        deep_copy: z
          .boolean()
          .optional()
          .describe("Also copy the campaign's ad sets and ads, not just the campaign shell (default true)."),
        ...confirmField,
      },
    },
    withErrorHandling(async ({ client_id, campaign_id, name_suffix, deep_copy, confirm }) => {
      const { accessToken } = resolveCredentials(client_id);
      const current = await graphGet<CampaignNameField>(campaign_id, { fields: "id,name" }, accessToken);

      const suffix = name_suffix ?? " - Copy";
      const deepCopy = deep_copy ?? true;

      if (!confirm) {
        return previewResult({
          action: "duplicate_campaign",
          target: { campaign_id, name: current.name },
          current_state: { name: current.name },
          proposed_change: {
            new_name: `${current.name ?? ""}${suffix}`,
            status: "PAUSED",
            deep_copy: deepCopy,
          },
          warnings: ["The copy is forced to PAUSED regardless of the source campaign's status."],
        });
      }

      const result = await graphPost<Record<string, unknown>>(
        `${campaign_id}/copies`,
        {
          deep_copy: deepCopy,
          status_option: "PAUSED",
          rename_options: JSON.stringify({ rename_strategy: "ONLY_TOP_LEVEL_RENAME", rename_suffix: suffix }),
        },
        accessToken,
      );
      return executedResult("duplicate_campaign", { campaign_id }, result);
    }),
  );
}
