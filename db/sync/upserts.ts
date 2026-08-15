// Upsert functions for every table this sync job writes to. Plain
// parameterized SQL, no ORM — same discipline as db/migrations/*.sql.
// Every INSERT here targets the natural-key UNIQUE constraint defined in
// Etape 2 (db/migrations/0001-0008) so a replayed sync updates, never
// stacks duplicates.

import type { Client } from "@neondatabase/serverless";
import { normalizeLearningStatus } from "./learning-phase.js";
import { parseAdNameForAngle } from "./angle-parser.js";

/** Meta returns campaign/adset budget & bid amounts as numeric strings ALREADY in minor units (e.g. "930" = 9.30). Pass through as text for Postgres to cast to bigint; null if missing or not a plain integer string. */
function toBigintParam(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value);
  return /^-?\d+$/.test(str) ? str : null;
}

/**
 * Insights spend/cpc/cpm come back as DECIMAL MAJOR-unit strings (e.g.
 * "1.73" EUR, "0.057667" EUR) — a different convention from
 * daily_budget/bid_amount above, confirmed against real account data during
 * this session (spend "1.73" / 30 clicks ~= cpc "0.057667", consistent only
 * as major-unit EUR, not cents). Converts to minor-unit bigint text.
 */
function toMinorUnitsParam(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? String(Math.round(num * 100)) : null;
}

function toTimestamptzParam(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// --- ad_accounts ---------------------------------------------------------

export interface AdAccountRow {
  id: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  business?: { id: string; name?: string };
}

export async function upsertAdAccount(client: Client, clientId: string, account: AdAccountRow): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO ad_accounts (client_id, meta_account_id, name, currency, timezone_name, business_id, business_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (meta_account_id) DO UPDATE SET
       client_id = EXCLUDED.client_id,
       name = EXCLUDED.name,
       currency = EXCLUDED.currency,
       timezone_name = EXCLUDED.timezone_name,
       business_id = EXCLUDED.business_id,
       business_name = EXCLUDED.business_name,
       updated_at = now()
     RETURNING id`,
    [
      clientId,
      account.id,
      account.name ?? null,
      account.currency ?? null,
      account.timezone_name ?? null,
      account.business?.id ?? null,
      account.business?.name ?? null,
    ],
  );
  return rows[0].id;
}

// --- campaigns_snapshot ----------------------------------------------------

export async function upsertCampaignSnapshot(
  client: Client,
  clientId: string,
  adAccountId: string,
  currency: string,
  capturedDate: string,
  campaign: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO campaigns_snapshot (
       client_id, ad_account_id, meta_campaign_id, captured_date, name,
       status_raw, effective_status_raw, objective_raw,
       daily_budget_minor, lifetime_budget_minor, budget_remaining_minor, currency,
       meta_start_time, meta_stop_time, meta_created_time, meta_updated_time
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (ad_account_id, meta_campaign_id, captured_date) DO UPDATE SET
       name = EXCLUDED.name,
       status_raw = EXCLUDED.status_raw,
       effective_status_raw = EXCLUDED.effective_status_raw,
       objective_raw = EXCLUDED.objective_raw,
       daily_budget_minor = EXCLUDED.daily_budget_minor,
       lifetime_budget_minor = EXCLUDED.lifetime_budget_minor,
       budget_remaining_minor = EXCLUDED.budget_remaining_minor,
       currency = EXCLUDED.currency,
       meta_start_time = EXCLUDED.meta_start_time,
       meta_stop_time = EXCLUDED.meta_stop_time,
       meta_created_time = EXCLUDED.meta_created_time,
       meta_updated_time = EXCLUDED.meta_updated_time,
       row_updated_at = now()`,
    [
      clientId,
      adAccountId,
      campaign.id,
      capturedDate,
      campaign.name ?? null,
      campaign.status ?? null,
      campaign.effective_status ?? null,
      campaign.objective ?? null,
      toBigintParam(campaign.daily_budget),
      toBigintParam(campaign.lifetime_budget),
      toBigintParam(campaign.budget_remaining),
      currency,
      toTimestamptzParam(campaign.start_time),
      toTimestamptzParam(campaign.stop_time),
      toTimestamptzParam(campaign.created_time),
      toTimestamptzParam(campaign.updated_time),
    ],
  );
}

// --- adsets_snapshot ---------------------------------------------------------

interface LearningPhase {
  status: string | null;
  conversions: number | null;
  last_significant_edit: string | null;
}

export async function upsertAdsetSnapshot(
  client: Client,
  clientId: string,
  adAccountId: string,
  currency: string,
  capturedDate: string,
  adset: Record<string, unknown>,
): Promise<void> {
  const learningPhase = (adset.learning_phase ?? null) as LearningPhase | null;
  const learningStatusRaw = learningPhase?.status ?? null;

  await client.query(
    `INSERT INTO adsets_snapshot (
       client_id, ad_account_id, meta_adset_id, meta_campaign_id, captured_date, name,
       status_raw, effective_status_raw, billing_event_raw, optimization_goal_raw, bid_strategy_raw,
       bid_amount_minor, daily_budget_minor, lifetime_budget_minor, currency, targeting,
       learning_status_raw, learning_status_normalized, learning_conversions, learning_last_significant_edit,
       meta_start_time, meta_end_time, meta_created_time, meta_updated_time
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     ON CONFLICT (ad_account_id, meta_adset_id, captured_date) DO UPDATE SET
       meta_campaign_id = EXCLUDED.meta_campaign_id,
       name = EXCLUDED.name,
       status_raw = EXCLUDED.status_raw,
       effective_status_raw = EXCLUDED.effective_status_raw,
       billing_event_raw = EXCLUDED.billing_event_raw,
       optimization_goal_raw = EXCLUDED.optimization_goal_raw,
       bid_strategy_raw = EXCLUDED.bid_strategy_raw,
       bid_amount_minor = EXCLUDED.bid_amount_minor,
       daily_budget_minor = EXCLUDED.daily_budget_minor,
       lifetime_budget_minor = EXCLUDED.lifetime_budget_minor,
       currency = EXCLUDED.currency,
       targeting = EXCLUDED.targeting,
       learning_status_raw = EXCLUDED.learning_status_raw,
       learning_status_normalized = EXCLUDED.learning_status_normalized,
       learning_conversions = EXCLUDED.learning_conversions,
       learning_last_significant_edit = EXCLUDED.learning_last_significant_edit,
       meta_start_time = EXCLUDED.meta_start_time,
       meta_end_time = EXCLUDED.meta_end_time,
       meta_created_time = EXCLUDED.meta_created_time,
       meta_updated_time = EXCLUDED.meta_updated_time,
       row_updated_at = now()`,
    [
      clientId,
      adAccountId,
      adset.id,
      adset.campaign_id,
      capturedDate,
      adset.name ?? null,
      adset.status ?? null,
      adset.effective_status ?? null,
      adset.billing_event ?? null,
      adset.optimization_goal ?? null,
      adset.bid_strategy ?? null,
      toBigintParam(adset.bid_amount),
      toBigintParam(adset.daily_budget),
      toBigintParam(adset.lifetime_budget),
      currency,
      adset.targeting ? JSON.stringify(adset.targeting) : null,
      learningStatusRaw,
      normalizeLearningStatus(learningStatusRaw),
      learningPhase?.conversions ?? null,
      learningPhase?.last_significant_edit ?? null,
      toTimestamptzParam(adset.start_time),
      toTimestamptzParam(adset.end_time),
      toTimestamptzParam(adset.created_time),
      toTimestamptzParam(adset.updated_time),
    ],
  );
}

// --- ads_snapshot --------------------------------------------------------

export async function upsertAdSnapshot(
  client: Client,
  clientId: string,
  adAccountId: string,
  capturedDate: string,
  ad: Record<string, unknown>,
): Promise<void> {
  const creative = ad.creative as { id?: string } | undefined;

  await client.query(
    `INSERT INTO ads_snapshot (
       client_id, ad_account_id, meta_ad_id, meta_adset_id, meta_campaign_id, meta_creative_id,
       captured_date, name, status_raw, effective_status_raw, meta_created_time, meta_updated_time
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (ad_account_id, meta_ad_id, captured_date) DO UPDATE SET
       meta_adset_id = EXCLUDED.meta_adset_id,
       meta_campaign_id = EXCLUDED.meta_campaign_id,
       meta_creative_id = EXCLUDED.meta_creative_id,
       name = EXCLUDED.name,
       status_raw = EXCLUDED.status_raw,
       effective_status_raw = EXCLUDED.effective_status_raw,
       meta_created_time = EXCLUDED.meta_created_time,
       meta_updated_time = EXCLUDED.meta_updated_time,
       row_updated_at = now()`,
    [
      clientId,
      adAccountId,
      ad.id,
      ad.adset_id,
      ad.campaign_id,
      creative?.id ?? null,
      capturedDate,
      ad.name ?? null,
      ad.status ?? null,
      ad.effective_status ?? null,
      toTimestamptzParam(ad.created_time),
      toTimestamptzParam(ad.updated_time),
    ],
  );
}

// --- creatives -------------------------------------------------------------

export async function upsertCreative(
  client: Client,
  clientId: string,
  adAccountId: string,
  metaAdId: string | null,
  creative: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO creatives (
       client_id, ad_account_id, meta_creative_id, meta_ad_id, name, body, title,
       call_to_action_type, image_url, video_id, thumbnail_url, object_type, object_story_spec
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (ad_account_id, meta_creative_id) DO UPDATE SET
       meta_ad_id = COALESCE(EXCLUDED.meta_ad_id, creatives.meta_ad_id),
       name = EXCLUDED.name,
       body = EXCLUDED.body,
       title = EXCLUDED.title,
       call_to_action_type = EXCLUDED.call_to_action_type,
       image_url = EXCLUDED.image_url,
       video_id = EXCLUDED.video_id,
       thumbnail_url = EXCLUDED.thumbnail_url,
       object_type = EXCLUDED.object_type,
       object_story_spec = EXCLUDED.object_story_spec,
       row_updated_at = now()`,
    [
      clientId,
      adAccountId,
      creative.id,
      metaAdId,
      creative.name ?? null,
      creative.body ?? null,
      creative.title ?? null,
      creative.call_to_action_type ?? null,
      creative.image_url ?? null,
      creative.video_id ?? null,
      creative.thumbnail_url ?? null,
      creative.object_type ?? null,
      creative.object_story_spec ? JSON.stringify(creative.object_story_spec) : null,
    ],
  );
}

// --- creative_angles ---------------------------------------------------------
//
// Maintains the first_seen_date invariant from db/README.md: the earliest
// date this angle_label was seen for this client, across any entity. Never
// overwrites a manually-tagged row (ON CONFLICT ... WHERE guards that at
// the SQL level, not just in application logic).

export interface AngleParseInput {
  clientId: string;
  metaEntityType: "campaign" | "adset" | "ad";
  metaEntityId: string;
  adName: string;
  /** UTC date (YYYY-MM-DD) to use as this ad's own launch_date candidate, e.g. from meta_created_time. */
  fallbackLaunchDate: string;
  pattern: string | undefined;
}

export async function upsertParsedCreativeAngle(client: Client, input: AngleParseInput): Promise<"created_or_updated" | "skipped_no_parse"> {
  const parsed = parseAdNameForAngle(input.adName, input.pattern);
  if (!parsed) return "skipped_no_parse";

  await client.query(
    `WITH earliest AS (
       SELECT LEAST(
         COALESCE(
           (SELECT MIN(first_seen_date) FROM creative_angles WHERE client_id = $1 AND angle_label = $2),
           $8::date
         ),
         $8::date
       ) AS d
     )
     INSERT INTO creative_angles (
       client_id, meta_entity_type, meta_entity_id, angle_category, angle_label,
       hook_excerpt, format, launch_date, first_seen_date, source
     )
     SELECT $1, $3, $4, $5, $2, $6, $7, $8::date, earliest.d, 'parsed'
     FROM earliest
     ON CONFLICT (meta_entity_type, meta_entity_id) DO UPDATE SET
       angle_category = EXCLUDED.angle_category,
       angle_label = EXCLUDED.angle_label,
       hook_excerpt = EXCLUDED.hook_excerpt,
       format = EXCLUDED.format,
       launch_date = EXCLUDED.launch_date,
       first_seen_date = LEAST(creative_angles.first_seen_date, EXCLUDED.first_seen_date),
       row_updated_at = now()
     WHERE creative_angles.source = 'parsed'`,
    [
      input.clientId,
      parsed.angleLabel,
      input.metaEntityType,
      input.metaEntityId,
      parsed.angleCategory,
      parsed.hookExcerpt,
      parsed.format,
      input.fallbackLaunchDate,
    ],
  );
  return "created_or_updated";
}

// --- insights_daily ----------------------------------------------------------

export interface InsightsBreakdowns {
  age?: string;
  gender?: string;
  publisher_platform?: string;
  platform_position?: string;
  impression_device?: string;
  device_platform?: string;
  region?: string;
  country?: string;
}

export async function upsertInsightRow(
  client: Client,
  clientId: string,
  adAccountId: string,
  entityType: "account" | "campaign" | "adset" | "ad",
  metaEntityId: string,
  currency: string,
  row: Record<string, unknown>,
): Promise<void> {
  const b = row as InsightsBreakdowns & Record<string, unknown>;

  await client.query(
    `INSERT INTO insights_daily (
       client_id, ad_account_id, entity_type, meta_entity_id, date,
       breakdown_age, breakdown_gender, breakdown_publisher_platform, breakdown_platform_position,
       breakdown_impression_device, breakdown_device_platform, breakdown_region, breakdown_country,
       impressions, reach, frequency, clicks, inline_link_clicks, ctr, cpc_minor, cpm_minor, spend_minor, currency,
       actions, action_values, cost_per_action_type, purchase_roas,
       quality_ranking, engagement_rate_ranking, conversion_rate_ranking
     ) VALUES (
       $1,$2,$3,$4,$5, $6,$7,$8,$9,$10,$11,$12,$13,
       $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
       $24,$25,$26,$27, $28,$29,$30
     )
     ON CONFLICT (
       ad_account_id, entity_type, meta_entity_id, date,
       breakdown_age, breakdown_gender, breakdown_publisher_platform, breakdown_platform_position,
       breakdown_impression_device, breakdown_device_platform, breakdown_region, breakdown_country
     ) DO UPDATE SET
       impressions = EXCLUDED.impressions,
       reach = EXCLUDED.reach,
       frequency = EXCLUDED.frequency,
       clicks = EXCLUDED.clicks,
       inline_link_clicks = EXCLUDED.inline_link_clicks,
       ctr = EXCLUDED.ctr,
       cpc_minor = EXCLUDED.cpc_minor,
       cpm_minor = EXCLUDED.cpm_minor,
       spend_minor = EXCLUDED.spend_minor,
       currency = EXCLUDED.currency,
       actions = EXCLUDED.actions,
       action_values = EXCLUDED.action_values,
       cost_per_action_type = EXCLUDED.cost_per_action_type,
       purchase_roas = EXCLUDED.purchase_roas,
       quality_ranking = EXCLUDED.quality_ranking,
       engagement_rate_ranking = EXCLUDED.engagement_rate_ranking,
       conversion_rate_ranking = EXCLUDED.conversion_rate_ranking,
       row_updated_at = now()`,
    [
      clientId,
      adAccountId,
      entityType,
      metaEntityId,
      row.date_start,
      b.age ?? "",
      b.gender ?? "",
      b.publisher_platform ?? "",
      b.platform_position ?? "",
      b.impression_device ?? "",
      b.device_platform ?? "",
      b.region ?? "",
      b.country ?? "",
      toBigintParam(row.impressions) ?? "0",
      toBigintParam(row.reach),
      row.frequency ?? null,
      toBigintParam(row.clicks) ?? "0",
      toBigintParam(row.inline_link_clicks),
      row.ctr ?? null,
      toMinorUnitsParam(row.cpc),
      toMinorUnitsParam(row.cpm),
      toMinorUnitsParam(row.spend) ?? "0",
      currency,
      row.actions ? JSON.stringify(row.actions) : null,
      row.action_values ? JSON.stringify(row.action_values) : null,
      row.cost_per_action_type ? JSON.stringify(row.cost_per_action_type) : null,
      row.purchase_roas ? JSON.stringify(row.purchase_roas) : null,
      row.quality_ranking ?? null,
      row.engagement_rate_ranking ?? null,
      row.conversion_rate_ranking ?? null,
    ],
  );
}
