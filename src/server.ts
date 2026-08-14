#!/usr/bin/env node
// Entry point for the Meta Ads MCP server.
//
// Currently boots an empty MCP server over stdio. Tools are registered
// incrementally in src/tools/read/* (Etape 2, priority 1) and
// src/tools/write/* (Etape 2, priority 2) once Etape 1 (auth) lands.
//
// Transport is stdio for local dev with Claude Code/Desktop. The tool
// registration below is transport-agnostic so a Streamable HTTP transport
// can be added later for a remote deployment without touching tool code.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "meta-ads-mcp",
  version: "0.1.0",
});

// TODO: register read tools (list_ad_accounts, get_campaigns, get_adsets,
// get_ads, get_insights, get_creatives, get_audience_estimate)
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
