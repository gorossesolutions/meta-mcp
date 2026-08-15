-- db/sync only ever writes insights_daily rows at entity_type='ad' (see
-- run-client.ts syncInsightsWindow — never 'adset'/'campaign'/'account',
-- even though the CHECK constraint on insights_daily.entity_type allows
-- all four). Confirmed live in the web dashboard: the Campaigns and Ad
-- sets pages query insights_daily WHERE entity_type = 'campaign'/'adset',
-- which can never match anything, so they showed dashes even for a
-- period with real ad-level spend.
--
-- Rather than have the sync job also fetch campaign/adset/account-level
-- insights from Meta (4x the API calls per client, more rate-limit
-- exposure), this view rolls the 'ad' rows we already have up to their
-- parent adset/campaign by joining through ads_latest — zero extra Meta
-- API calls, uses data already being synced. Tradeoff accepted: reach/
-- frequency here are the SUM across each ad, not Meta's own deduplicated
-- unique-reach figure for the adset/campaign as a whole (those two ads
-- could show the same person twice). Fine for spend/impressions/clicks
-- and everything derived from them; reach/frequency at rollup level
-- should be read as directional, not exact — see web/README.md.
--
-- Same "no separate RLS policy needed" note as the *_latest views in
-- 0003_snapshots.sql: this runs with the querying role's own rights, so
-- insights_daily's and ads_snapshot's RLS policies both apply through
-- the join automatically.

CREATE OR REPLACE VIEW insights_daily_ad_rollup AS
SELECT
  i.client_id,
  i.ad_account_id,
  i.meta_entity_id AS ad_id,
  a.meta_adset_id,
  a.meta_campaign_id,
  i.date,
  i.breakdown_age,
  i.breakdown_gender,
  i.breakdown_publisher_platform,
  i.breakdown_platform_position,
  i.breakdown_impression_device,
  i.breakdown_device_platform,
  i.breakdown_region,
  i.breakdown_country,
  i.impressions,
  i.reach,
  i.frequency,
  i.clicks,
  i.inline_link_clicks,
  i.ctr,
  i.cpc_minor,
  i.cpm_minor,
  i.spend_minor,
  i.currency,
  i.actions,
  i.action_values,
  i.cost_per_action_type,
  i.purchase_roas,
  i.quality_ranking,
  i.engagement_rate_ranking,
  i.conversion_rate_ranking
FROM insights_daily i
JOIN ads_latest a ON a.ad_account_id = i.ad_account_id AND a.meta_ad_id = i.meta_entity_id
WHERE i.entity_type = 'ad';

GRANT SELECT ON insights_daily_ad_rollup TO authenticated;
