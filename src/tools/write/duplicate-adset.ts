import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveCredentials } from "../../client/auth.js";
import { graphGet, graphPost } from "../../client/meta-api.js";
import { confirmField, previewResult, executedResult, withErrorHandling } from "../shared.js";

interface AdsetNameField {
  id: string;
  name?: string;
}

export function registerDuplicateAdsetTool(server: McpServer): void {
  server.registerTool(
    "duplicate_adset",
    {
      title: "Duplicate ad set",
      description:
        "Duplicates an ad set (and, with deep_copy, its ads) for A/B testing, optionally into a different campaign. The copy is always created PAUSED regardless of the source ad set's status. Always previews first — call again with confirm: true to execute.",
      inputSchema: {
        client_id: z
          .string()
          .optional()
          .describe("Client identifier from accounts.config.json. Omit to use the default META_ACCESS_TOKEN."),
        adset_id: z.string().describe("Ad set id to duplicate."),
        name_suffix: z.string().optional().describe('Appended to the source name for the copy (default " - Copy").'),
        target_campaign_id: z
          .string()
          .optional()
          .describe("Move the copy into this campaign instead of the source ad set's campaign."),
        deep_copy: z
          .boolean()
          .optional()
          .describe("Also copy the ad set's ads, not just the ad set shell (default true)."),
        ...confirmField,
      },
    },
    withErrorHandling(async ({ client_id, adset_id, name_suffix, target_campaign_id, deep_copy, confirm }) => {
      const { accessToken } = resolveCredentials(client_id);
      const current = await graphGet<AdsetNameField>(adset_id, { fields: "id,name" }, accessToken);

      const suffix = name_suffix ?? " - Copy";
      const deepCopy = deep_copy ?? true;

      if (!confirm) {
        return previewResult({
          action: "duplicate_adset",
          target: { adset_id, name: current.name },
          current_state: { name: current.name },
          proposed_change: {
            new_name: `${current.name ?? ""}${suffix}`,
            status: "PAUSED",
            deep_copy: deepCopy,
            target_campaign_id: target_campaign_id ?? "(same campaign)",
          },
          warnings: ["The copy is forced to PAUSED regardless of the source ad set's status."],
        });
      }

      const result = await graphPost<Record<string, unknown>>(
        `${adset_id}/copies`,
        {
          deep_copy: deepCopy,
          status_option: "PAUSED",
          rename_options: JSON.stringify({ rename_strategy: "ONLY_TOP_LEVEL_RENAME", rename_suffix: suffix }),
          campaign_id: target_campaign_id,
        },
        accessToken,
      );
      return executedResult("duplicate_adset", { adset_id }, result);
    }),
  );
}
