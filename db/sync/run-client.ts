// Orchestrates the sync sequence for one client. Reuses the MCP read tools'
// plain functions directly (src/tools/read/*.ts) — no MCP protocol
// involved, see file header of db/sync/cli.ts for why.
//
// Split into two phases deliberately: syncEntities() (steps 2-5: ad
// account, campaigns/adsets/ads snapshots, creatives, angles) runs ONCE per
// invocation — none of it is date-windowed, so a chunked backfill must
// never repeat it. syncInsightsWindow() (step 6) is the one phase that
// takes a date range and is safe/meant to be called once per chunk during a
// backfill — see cli.ts.

import type { Client } from "@neondatabase/serverless";
import { listAdAccounts } from "../../src/tools/read/list-ad-accounts.js";
import { getCampaigns } from "../../src/tools/read/get-campaigns.js";
import { getAdsets } from "../../src/tools/read/get-adsets.js";
import { getAds } from "../../src/tools/read/get-ads.js";
import { getCreatives } from "../../src/tools/read/get-creatives.js";
import { getInsights, type BreakdownDimension } from "../../src/tools/read/get-insights.js";
import {
  upsertAdAccount,
  upsertCampaignSnapshot,
  upsertAdsetSnapshot,
  upsertAdSnapshot,
  upsertCreative,
  upsertParsedCreativeAngle,
  upsertInsightRow,
} from "./upserts.js";

const SYNC_LIMIT = 500; // max page size the read tools accept — no pagination beyond one page yet, see db/README.md limitations

function msg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function utcDateOf(isoTimestamp: string | undefined): string {
  return isoTimestamp ? isoTimestamp.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

export interface StepResult {
  entitiesProcessed: number;
  errors: string[];
}

export interface EntitiesResult extends StepResult {
  adAccountRowId: string;
  currency: string;
  /** Every ad fetched this run, kept in memory so the insights phase doesn't need to re-list them. */
  ads: Record<string, unknown>[];
}

export async function syncEntities(
  db: Client,
  configClientId: string,
  neonClientId: string,
  expectedMetaAccountId: string,
  capturedDate: string,
  dryRun: boolean,
  anglePattern: string | undefined,
): Promise<EntitiesResult> {
  const errors: string[] = [];
  let entitiesProcessed = 0;

  // --- Step 2: ad account -----------------------------------------------
  const accounts = await listAdAccounts({ client_id: configClientId });
  const account = accounts.find((a) => a.id === expectedMetaAccountId);
  if (!account) {
    throw new Error(
      `Ad account ${expectedMetaAccountId} (from accounts.config.json) is not visible with this client's token — check the token's permissions.`,
    );
  }

  const currency = account.currency ?? "EUR";
  let adAccountRowId: string;
  if (dryRun) {
    console.log(`[dry-run] ad_accounts: ${account.id} — ${account.currency}, ${account.timezone_name}`);
    adAccountRowId = "00000000-0000-0000-0000-000000000000";
  } else {
    adAccountRowId = await upsertAdAccount(db, neonClientId, account);
  }
  entitiesProcessed += 1;

  // --- Step 3: campaigns / ad sets / ads snapshots -----------------------
  let campaigns: Record<string, unknown>[] = [];
  try {
    campaigns = await getCampaigns({ client_id: configClientId, limit: SYNC_LIMIT });
    for (const campaign of campaigns) {
      if (dryRun) {
        console.log(`[dry-run] campaigns_snapshot: ${campaign.id} "${campaign.name}" (${campaign.status})`);
      } else {
        await upsertCampaignSnapshot(db, neonClientId, adAccountRowId, currency, capturedDate, campaign);
      }
      entitiesProcessed += 1;
    }
  } catch (error) {
    errors.push(`campaigns_snapshot: ${msg(error)}`);
  }

  const allAds: Record<string, unknown>[] = [];
  for (const campaign of campaigns) {
    const campaignId = String(campaign.id);
    try {
      const adsets = await getAdsets({ client_id: configClientId, campaign_id: campaignId, limit: SYNC_LIMIT });
      for (const adset of adsets) {
        if (dryRun) {
          const lp = adset.learning_phase as { status?: string | null } | null;
          console.log(
            `[dry-run] adsets_snapshot: ${adset.id} "${adset.name}" learning_phase.status=${lp?.status ?? "null"}`,
          );
        } else {
          await upsertAdsetSnapshot(db, neonClientId, adAccountRowId, currency, capturedDate, adset);
        }
        entitiesProcessed += 1;

        try {
          const ads = await getAds({ client_id: configClientId, adset_id: String(adset.id), limit: SYNC_LIMIT });
          for (const ad of ads) {
            if (dryRun) {
              console.log(`[dry-run] ads_snapshot: ${ad.id} "${ad.name}"`);
            } else {
              await upsertAdSnapshot(db, neonClientId, adAccountRowId, capturedDate, ad);
            }
            entitiesProcessed += 1;
            allAds.push(ad);
          }
        } catch (error) {
          errors.push(`ads_snapshot (adset ${adset.id}): ${msg(error)}`);
        }
      }
    } catch (error) {
      errors.push(`adsets_snapshot (campaign ${campaignId}): ${msg(error)}`);
    }
  }

  // --- Step 4: creatives (bulk list for the account) ----------------------
  try {
    const creativeToAdId = new Map<string, string>();
    for (const ad of allAds) {
      const creative = ad.creative as { id?: string } | undefined;
      if (creative?.id) creativeToAdId.set(creative.id, String(ad.id));
    }

    const creatives = await getCreatives({ client_id: configClientId, limit: SYNC_LIMIT });
    const creativeList = Array.isArray(creatives) ? creatives : [creatives];
    for (const creative of creativeList) {
      const creativeId = String(creative.id);
      const metaAdId = creativeToAdId.get(creativeId) ?? null;
      if (dryRun) {
        console.log(`[dry-run] creatives: ${creativeId} "${creative.name ?? ""}"`);
      } else {
        await upsertCreative(db, neonClientId, adAccountRowId, metaAdId, creative);
      }
      entitiesProcessed += 1;
    }
  } catch (error) {
    errors.push(`creatives: ${msg(error)}`);
  }

  // --- Step 5: creative_angles (parsed from ad name; manual rows never touched) ---
  try {
    let parsedCount = 0;
    for (const ad of allAds) {
      if (dryRun) continue; // parsing preview omitted to keep dry-run output focused on the volume-heavy steps
      const adName = typeof ad.name === "string" ? ad.name : "";
      const launchDate = utcDateOf(ad.created_time as string | undefined);
      const result = await upsertParsedCreativeAngle(db, {
        clientId: neonClientId,
        metaEntityType: "ad",
        metaEntityId: String(ad.id),
        adName,
        fallbackLaunchDate: launchDate,
        pattern: anglePattern,
      });
      if (result === "created_or_updated") parsedCount += 1;
    }
    if (dryRun) {
      console.log(
        `[dry-run] creative_angles: would attempt parsing on ${allAds.length} ad name(s) (pattern ${anglePattern ? "set" : "unset — parsing disabled"})`,
      );
    } else {
      console.log(
        `[sync] creative_angles: parsed and upserted ${parsedCount}/${allAds.length} ad(s) (rest left untagged for manual entry, per policy)`,
      );
    }
  } catch (error) {
    errors.push(`creative_angles: ${msg(error)}`);
  }

  return { adAccountRowId, currency, ads: allAds, entitiesProcessed, errors };
}

export async function syncInsightsWindow(
  db: Client,
  configClientId: string,
  neonClientId: string,
  adAccountRowId: string,
  currency: string,
  ads: Record<string, unknown>[],
  since: string,
  until: string,
  breakdown: BreakdownDimension | undefined,
  dryRun: boolean,
): Promise<StepResult> {
  const errors: string[] = [];
  let entitiesProcessed = 0;
  const breakdowns = breakdown ? [breakdown] : undefined;

  for (const ad of ads) {
    try {
      const rows = await getInsights({
        client_id: configClientId,
        object_id: String(ad.id),
        level: "ad",
        since,
        until,
        breakdowns,
        limit: SYNC_LIMIT,
      });
      for (const row of rows) {
        if (dryRun) {
          console.log(`[dry-run] insights_daily: ad ${ad.id} date=${row.date_start} spend=${row.spend ?? 0}`);
        } else {
          await upsertInsightRow(db, neonClientId, adAccountRowId, "ad", String(ad.id), currency, row);
        }
        entitiesProcessed += 1;
      }
    } catch (error) {
      errors.push(`insights_daily (ad ${ad.id}): ${msg(error)}`);
    }
  }

  return { entitiesProcessed, errors };
}
