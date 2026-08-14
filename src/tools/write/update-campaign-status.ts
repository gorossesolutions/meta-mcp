import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveCredentials } from "../../client/auth.js";
import { graphGet, graphPost } from "../../client/meta-api.js";
import { confirmField, previewResult, executedResult, withErrorHandling } from "../shared.js";

const STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;

interface CampaignStatusFields {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
}

export function registerUpdateCampaignStatusTool(server: McpServer): void {
  server.registerTool(
    "update_campaign_status",
    {
      title: "Update campaign status",
      description:
        "Pauses, resumes (activates) or archives a campaign. Always previews the change first — call again with confirm: true to execute.",
      inputSchema: {
        client_id: z
          .string()
          .optional()
          .describe("Client identifier from accounts.config.json. Omit to use the default META_ACCESS_TOKEN."),
        campaign_id: z.string().describe("Campaign id to update."),
        status: z.enum(STATUSES).describe("New status."),
        ...confirmField,
      },
    },
    withErrorHandling(async ({ client_id, campaign_id, status, confirm }) => {
      const { accessToken } = resolveCredentials(client_id);

      const current = await graphGet<CampaignStatusFields>(
        campaign_id,
        { fields: "id,name,status,effective_status" },
        accessToken,
      );

      if (!confirm) {
        const warnings: string[] = [];
        if (status === "ACTIVE") {
          warnings.push("This will activate the campaign, which starts spending its budget.");
        }
        return previewResult({
          action: "update_campaign_status",
          target: { campaign_id, name: current.name },
          current_state: { status: current.status, effective_status: current.effective_status },
          proposed_change: { status },
          warnings,
        });
      }

      const result = await graphPost<{ success?: boolean }>(campaign_id, { status }, accessToken);
      return executedResult("update_campaign_status", { campaign_id, status }, result);
    }),
  );
}
