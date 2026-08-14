#!/usr/bin/env node
// Entry point for the Meta Ads MCP server.
//
// Transport is stdio for local dev with Claude Code/Desktop. Tool
// registration below is transport-agnostic so a Streamable HTTP transport
// can be added later for a remote deployment without touching tool code.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerListAdAccountsTool } from "./tools/read/list-ad-accounts.js";
import { registerGetCampaignsTool } from "./tools/read/get-campaigns.js";
import { registerGetAdsetsTool } from "./tools/read/get-adsets.js";
import { registerGetAdsTool } from "./tools/read/get-ads.js";
import { registerGetInsightsTool } from "./tools/read/get-insights.js";
import { registerGetCreativesTool } from "./tools/read/get-creatives.js";
import { registerGetAudienceEstimateTool } from "./tools/read/get-audience-estimate.js";

const server = new McpServer({
  name: "meta-ads-mcp",
  version: "0.1.0",
});

registerListAdAccountsTool(server);
registerGetCampaignsTool(server);
registerGetAdsetsTool(server);
registerGetAdsTool(server);
registerGetInsightsTool(server);
registerGetCreativesTool(server);
registerGetAudienceEstimateTool(server);

// TODO: register write tools (update_campaign_status, update_adset_budget,
// update_adset_bid, create_campaign, duplicate_campaign, duplicate_adset,
// update_targeting_exclusions)

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("meta-ads-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting meta-ads-mcp:", error);
  process.exit(1);
});
