import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveCredentials } from "../../client/auth.js";
import { graphGet, graphPost } from "../../client/meta-api.js";
import { confirmField, previewResult, executedResult, withErrorHandling } from "../shared.js";

interface AdsetTargetingFields {
  id: string;
  name?: string;
  targeting?: Record<string, unknown>;
}

export function registerUpdateTargetingExclusionsTool(server: McpServer): void {
  server.registerTool(
    "update_targeting_exclusions",
    {
      title: "Update targeting exclusions",
      description:
        "Manages exclusion audiences on an ad set: excluded custom/lookalike audiences, excluded geo locations, and excluded interests/behaviors. Merges into the ad set's existing targeting. Always previews the change first — call again with confirm: true to execute.",
      inputSchema: {
        client_id: z
          .string()
          .optional()
          .describe("Client identifier from accounts.config.json. Omit to use the default META_ACCESS_TOKEN."),
        adset_id: z.string().describe("Ad set id to update."),
        excluded_custom_audience_ids: z
          .array(z.string())
          .optional()
          .describe("Custom/lookalike audience ids to exclude (replaces the current list)."),
        excluded_geo_locations: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Raw excluded_geo_locations object, e.g. { "countries": ["CI"] } (replaces the current value).'),
        exclusions: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Raw targeting.exclusions object for interest/behavior exclusions, e.g. { "interests": [{ "id": "...", "name": "..." }] } (replaces the current value).',
          ),
        ...confirmField,
      },
    },
    withErrorHandling(
      async ({
        client_id,
        adset_id,
        excluded_custom_audience_ids,
        excluded_geo_locations,
        exclusions,
        confirm,
      }) => {
        if (!excluded_custom_audience_ids && !excluded_geo_locations && !exclusions) {
          throw new Error("Provide at least one of excluded_custom_audience_ids, excluded_geo_locations, exclusions.");
        }

        const { accessToken } = resolveCredentials(client_id);
        const current = await graphGet<AdsetTargetingFields>(adset_id, { fields: "id,name,targeting" }, accessToken);
        const currentTargeting = current.targeting ?? {};

        const proposedTargeting: Record<string, unknown> = { ...currentTargeting };
        if (excluded_custom_audience_ids) {
          proposedTargeting.excluded_custom_audiences = excluded_custom_audience_ids.map((id) => ({ id }));
        }
        if (excluded_geo_locations) {
          proposedTargeting.excluded_geo_locations = excluded_geo_locations;
        }
        if (exclusions) {
          proposedTargeting.exclusions = exclusions;
        }

        if (!confirm) {
          return previewResult({
            action: "update_targeting_exclusions",
            target: { adset_id, name: current.name },
            current_state: {
              excluded_custom_audiences: currentTargeting.excluded_custom_audiences,
              excluded_geo_locations: currentTargeting.excluded_geo_locations,
              exclusions: currentTargeting.exclusions,
            },
            proposed_change: {
              excluded_custom_audiences: proposedTargeting.excluded_custom_audiences,
              excluded_geo_locations: proposedTargeting.excluded_geo_locations,
              exclusions: proposedTargeting.exclusions,
            },
          });
        }

        const result = await graphPost<{ success?: boolean }>(
          adset_id,
          { targeting: JSON.stringify(proposedTargeting) },
          accessToken,
        );
        return executedResult("update_targeting_exclusions", { adset_id }, result);
      },
    ),
  );
}
