import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveCredentials } from "../../client/auth.js";
import { graphGet, graphPost } from "../../client/meta-api.js";
import { confirmField, previewResult, executedResult, withErrorHandling } from "../shared.js";

const BID_STRATEGIES = [
  "LOWEST_COST_WITHOUT_CAP",
  "LOWEST_COST_WITH_BID_CAP",
  "COST_CAP",
  "LOWEST_COST_WITH_MIN_ROAS",
] as const;

interface AdsetBidFields {
  id: string;
  name?: string;
  bid_amount?: string;
  bid_strategy?: string;
}

export function registerUpdateAdsetBidTool(server: McpServer): void {
  server.registerTool(
    "update_adset_bid",
    {
      title: "Update ad set bid",
      description:
        "Adjusts an ad set's bid amount and/or bid strategy. Always previews the change first — call again with confirm: true to execute.",
      inputSchema: {
        client_id: z
          .string()
          .optional()
          .describe("Client identifier from accounts.config.json. Omit to use the default META_ACCESS_TOKEN."),
        adset_id: z.string().describe("Ad set id to update."),
        bid_amount: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("New bid cap, in the account's minor currency unit (e.g. cents)."),
        bid_strategy: z.enum(BID_STRATEGIES).optional().describe("New bid strategy."),
        ...confirmField,
      },
    },
    withErrorHandling(async ({ client_id, adset_id, bid_amount, bid_strategy, confirm }) => {
      if (bid_amount === undefined && bid_strategy === undefined) {
        throw new Error("Provide bid_amount and/or bid_strategy.");
      }

      const { accessToken } = resolveCredentials(client_id);
      const current = await graphGet<AdsetBidFields>(
        adset_id,
        { fields: "id,name,bid_amount,bid_strategy" },
        accessToken,
      );

      const proposedChange: Record<string, string | number> = {};
      if (bid_amount !== undefined) proposedChange.bid_amount = bid_amount;
      if (bid_strategy !== undefined) proposedChange.bid_strategy = bid_strategy;

      if (!confirm) {
        return previewResult({
          action: "update_adset_bid",
          target: { adset_id, name: current.name },
          current_state: { bid_amount: current.bid_amount, bid_strategy: current.bid_strategy },
          proposed_change: proposedChange,
        });
      }

      const result = await graphPost<{ success?: boolean }>(adset_id, proposedChange, accessToken);
      return executedResult("update_adset_bid", { adset_id, ...proposedChange }, result);
    }),
  );
}
