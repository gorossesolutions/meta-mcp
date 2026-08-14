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

  await run("list_ad_accounts", () => listAdAccounts({ client_id: clientId }));

  const campaigns = await run("get_campaigns", () =>
    getCampaigns({ client_id: clientId, account_id: accountId, limit: 5 }),
  );
  const firstCampaignId = Array.isArray(campaigns)
    ? (campaigns[0] as { id?: string } | undefined)?.id
    : undefined;

  await run("get_adsets", () =>
    getAdsets({ client_id: clientId, account_id: accountId, campaign_id: firstCampaignId, limit: 5 }),
  );

  await run("get_ads", () =>
    getAds({ client_id: clientId, account_id: accountId, campaign_id: firstCampaignId, limit: 5 }),
  );

  await run("get_insights", () =>
    getInsights({ client_id: clientId, account_id: accountId, object_id: firstCampaignId, date_preset: "last_30d" }),
  );

  await run("get_creatives", () => getCreatives({ client_id: clientId, account_id: accountId, limit: 5 }));

  await run("get_audience_estimate", () =>
    getAudienceEstimate({
      client_id: clientId,
      account_id: accountId,
      targeting: { geo_locations: { countries: ["FR"] }, age_min: 25, age_max: 45 },
    }),
  );
}

main();
