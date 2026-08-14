import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveCredentials } from "../../client/auth.js";
import { graphGet, graphPost } from "../../client/meta-api.js";
import {
  budgetChangeWarnings,
  budgetDeltaPercent,
  confirmField,
  previewResult,
  executedResult,
  withErrorHandling,
} from "../shared.js";

interface AdsetBudgetFields {
  id: string;
  name?: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

export function registerUpdateAdsetBudgetTool(server: McpServer): void {
  server.registerTool(
    "update_adset_budget",
    {
      title: "Update ad set budget",
      description:
        "Adjusts an ad set's daily or lifetime budget (in the account's minor currency unit, e.g. cents). Always previews the change first, with the computed % delta — call again with confirm: true to execute.",
      inputSchema: {
        client_id: z
          .string()
          .optional()
          .describe("Client identifier from accounts.config.json. Omit to use the default META_ACCESS_TOKEN."),
        adset_id: z.string().describe("Ad set id to update."),
        daily_budget: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("New daily budget, in minor currency units (e.g. cents). Mutually exclusive with lifetime_budget."),
        lifetime_budget: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("New lifetime budget, in minor currency units. Mutually exclusive with daily_budget."),
        ...confirmField,
      },
    },
    withErrorHandling(async ({ client_id, adset_id, daily_budget, lifetime_budget, confirm }) => {
      if (!daily_budget === !lifetime_budget) {
        throw new Error("Provide exactly one of daily_budget or lifetime_budget.");
      }

      const { accessToken } = resolveCredentials(client_id);
      const current = await graphGet<AdsetBudgetFields>(
        adset_id,
        { fields: "id,name,daily_budget,lifetime_budget" },
        accessToken,
      );

      const field = daily_budget !== undefined ? "daily_budget" : "lifetime_budget";
      const proposedValue = (daily_budget ?? lifetime_budget) as number;
      const currentValue = Number(current[field] ?? 0);
      const deltaPercent = budgetDeltaPercent(currentValue, proposedValue);

      if (!confirm) {
        return previewResult({
          action: "update_adset_budget",
          target: { adset_id, name: current.name },
          current_state: { [field]: currentValue },
          proposed_change: { [field]: proposedValue, delta_percent: deltaPercent },
          warnings: budgetChangeWarnings(deltaPercent),
        });
      }

      const result = await graphPost<{ success?: boolean }>(adset_id, { [field]: proposedValue }, accessToken);
      return executedResult("update_adset_budget", { adset_id, [field]: proposedValue }, result);
    }),
  );
}
