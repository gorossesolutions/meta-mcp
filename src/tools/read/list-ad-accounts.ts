import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveCredentials } from "../../client/auth.js";
import { graphGet } from "../../client/meta-api.js";
import { jsonResult, withErrorHandling } from "../shared.js";
import type { GraphApiListResponse } from "../../types/index.js";

export interface AdAccountSummary {
  id: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
  business_name?: string;
}

export async function listAdAccounts(input: { client_id?: string }): Promise<AdAccountSummary[]> {
  const { accessToken } = resolveCredentials(input.client_id);
  const response = await graphGet<GraphApiListResponse<AdAccountSummary>>(
    "me/adaccounts",
    { fields: "id,name,account_status,currency,timezone_name,business_name" },
    accessToken,
  );
  return response.data;
}

export function registerListAdAccountsTool(server: McpServer): void {
  server.registerTool(
    "list_ad_accounts",
    {
      title: "List ad accounts",
      description:
        "Lists the Meta ad accounts accessible with the resolved token (a specific client's token if client_id is given, otherwise the default META_ACCESS_TOKEN).",
      inputSchema: {
        client_id: z
          .string()
          .optional()
          .describe("Client identifier from accounts.config.json. Omit to use the default META_ACCESS_TOKEN."),
      },
    },
    withErrorHandling(async ({ client_id }) => jsonResult(await listAdAccounts({ client_id }))),
  );
}
