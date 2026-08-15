// Manual smoke test script — calls each read tool's core logic directly
// (bypassing the MCP transport) against the real Meta API and prints the
// result, so each tool can be validated one by one before wiring the
// server into Claude Code for real usage.
//
// Usage:
//   npm run test:manual
//   npm run test:manual -- --client my-client   # use a configured client
//   npm run test:manual -- --account act_123    # or an explicit ad account
//
// Requires .env to be loaded (e.g. `node --env-file=.env` or export the
// vars yourself) and, for get_audience_estimate, a real ad account with
// delivery_estimate access.
//
// At the end, prints a "Field availability" report: several fields (learning
// phase status, ad relevance rankings) are only populated under specific
// conditions (ad set actively delivering, ad past ~500 impressions) — this
// report makes explicit what actually comes back null/UNKNOWN on this
// account, rather than hiding it inside a wall of JSON.

import { listAdAccounts } from "../src/tools/read/list-ad-accounts.js";
import { getCampaigns } from "../src/tools/read/get-campaigns.js";
import { getAdsets } from "../src/tools/read/get-adsets.js";
import { getAds } from "../src/tools/read/get-ads.js";
import { getInsights } from "../src/tools/read/get-insights.js";
import { getCreatives } from "../src/tools/read/get-creatives.js";
import { getAudienceEstimate } from "../src/tools/read/get-audience-estimate.js";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const clientId = argValue("--client");
const accountId = argValue("--account");

async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  console.log(`\n=== ${label} ===`);
  try {
    const result = await fn();
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("FAILED:", error instanceof Error ? error.message : error);
    return undefined;
  }
}

async function main() {
  if (!clientId && !accountId && !process.env.META_ACCESS_TOKEN) {
    console.error(
      "No credentials available: set META_ACCESS_TOKEN in .env, or pass --client <id> / --account act_XXX.",
    );
    process.exit(1);
  }

  const accounts = await run("list_ad_accounts", () => listAdAccounts({ client_id: clientId }));
  const firstAccount = accounts?.[0];

  const campaigns = await run("get_campaigns", () =>
    getCampaigns({ client_id: clientId, account_id: accountId, limit: 5 }),
  );
  const firstCampaignId = (campaigns?.[0] as { id?: string } | undefined)?.id;

  const adsets = await run("get_adsets", () =>
    getAdsets({ client_id: clientId, account_id: accountId, campaign_id: firstCampaignId, limit: 5 }),
  );
  const firstAdset = adsets?.[0] as { id?: string; learning_phase?: Record<string, unknown> } | undefined;

  const ads = await run("get_ads", () =>
    getAds({ client_id: clientId, account_id: accountId, campaign_id: firstCampaignId, limit: 5 }),
  );
  const firstAdId = (ads?.[0] as { id?: string } | undefined)?.id;

  await run("get_insights (account/campaign level)", () =>
    getInsights({ client_id: clientId, account_id: accountId, object_id: firstCampaignId, date_preset: "last_30d" }),
  );

  const adInsights = await run("get_insights (ad level, with quality rankings)", () =>
    getInsights({
      client_id: clientId,
      account_id: accountId,
      object_id: firstAdId,
      level: "ad",
      date_preset: "maximum",
    }),
  );
  const firstAdInsight = adInsights?.[0] as Record<string, unknown> | undefined;

  await run("get_creatives", () => getCreatives({ client_id: clientId, account_id: accountId, limit: 5 }));

  await run("get_audience_estimate", () =>
    getAudienceEstimate({
      client_id: clientId,
      account_id: accountId,
      targeting: { geo_locations: { countries: ["FR"] }, age_min: 25, age_max: 45 },
    }),
  );

  console.log("\n=== Field availability report ===");
  const rows: Array<[string, string]> = [
    ["list_ad_accounts.business", firstAccount?.business ? JSON.stringify(firstAccount.business) : "MISSING"],
    ["get_adsets.learning_phase.status", String(firstAdset?.learning_phase?.status ?? "null")],
    ["get_adsets.learning_phase.conversions", String(firstAdset?.learning_phase?.conversions ?? "null")],
    [
      "get_adsets.learning_phase.attribution_windows",
      JSON.stringify(firstAdset?.learning_phase?.attribution_windows ?? null),
    ],
    ["get_insights(ad).quality_ranking", String(firstAdInsight?.quality_ranking ?? "MISSING")],
    ["get_insights(ad).engagement_rate_ranking", String(firstAdInsight?.engagement_rate_ranking ?? "MISSING")],
    ["get_insights(ad).conversion_rate_ranking", String(firstAdInsight?.conversion_rate_ranking ?? "MISSING")],
    ["get_insights(ad).inline_link_clicks", String(firstAdInsight?.inline_link_clicks ?? "MISSING")],
    [
      "get_insights(ad).cost_per_action_type",
      Array.isArray(firstAdInsight?.cost_per_action_type) ? `${firstAdInsight.cost_per_action_type.length} entries` : "MISSING",
    ],
  ];
  for (const [field, value] of rows) {
    console.log(`  ${field.padEnd(45)} ${value}`);
  }
  console.log(
    "\nNote: learning_phase.status/conversions are null unless the ad set is actively delivering (effective_status ACTIVE).",
  );
  console.log("Note: quality/engagement/conversion rankings return \"UNKNOWN\" below ~500 impressions on the ad.");
}

main();
