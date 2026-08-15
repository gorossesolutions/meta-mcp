// Row shapes for the tables/views this app reads and writes through the
// Data API. Deliberately hand-written to match db/migrations/*.sql rather
// than generated — keeps the "no ORM, control the SQL" discipline from the
// rest of this repo. Update alongside schema changes.

export interface Client {
  id: string;
  name: string;
  is_active: boolean;
}

export interface AdAccount {
  id: string;
  client_id: string;
  meta_account_id: string;
  name: string | null;
  currency: string;
  timezone_name: string;
  business_id: string | null;
  business_name: string | null;
}

/** Fields common to campaigns_latest / adsets_latest / ads_latest. */
interface SnapshotCommon {
  client_id: string;
  ad_account_id: string;
  captured_date: string;
  name: string | null;
  status_raw: string | null;
  effective_status_raw: string | null;
  meta_created_time: string | null;
  meta_updated_time: string | null;
}

export interface CampaignLatest extends SnapshotCommon {
  meta_campaign_id: string;
  objective_raw: string | null;
  daily_budget_minor: string | null;
  lifetime_budget_minor: string | null;
  budget_remaining_minor: string | null;
  currency: string | null;
  meta_start_time: string | null;
  meta_stop_time: string | null;
}

export interface AdsetLatest extends SnapshotCommon {
  meta_adset_id: string;
  meta_campaign_id: string;
  billing_event_raw: string | null;
  optimization_goal_raw: string | null;
  bid_strategy_raw: string | null;
  bid_amount_minor: string | null;
  daily_budget_minor: string | null;
  lifetime_budget_minor: string | null;
  currency: string | null;
  targeting: Record<string, unknown> | null;
  learning_status_raw: string | null;
  learning_status_normalized: string | null;
  learning_conversions: number | null;
  learning_last_significant_edit: string | null;
  meta_start_time: string | null;
  meta_end_time: string | null;
}

export interface AdLatest extends SnapshotCommon {
  meta_ad_id: string;
  meta_adset_id: string;
  meta_campaign_id: string;
  meta_creative_id: string | null;
}

export interface Creative {
  id: string;
  client_id: string;
  ad_account_id: string;
  meta_creative_id: string;
  meta_ad_id: string | null;
  name: string | null;
  body: string | null;
  title: string | null;
  call_to_action_type: string | null;
  image_url: string | null;
  video_id: string | null;
  thumbnail_url: string | null;
  object_type: string | null;
}

export interface InsightsDailyRow {
  ad_account_id: string;
  entity_type: "account" | "campaign" | "adset" | "ad";
  meta_entity_id: string;
  date: string;
  impressions: string;
  reach: string | null;
  frequency: string | null;
  clicks: string;
  inline_link_clicks: string | null;
  ctr: string | null;
  cpc_minor: string | null;
  cpm_minor: string | null;
  spend_minor: string;
  currency: string;
  actions: Array<{ action_type: string; value: string }> | null;
  action_values: Array<{ action_type: string; value: string }> | null;
  cost_per_action_type: Array<{ action_type: string; value: string }> | null;
  purchase_roas: Array<{ action_type: string; value: string }> | null;
  quality_ranking: string | null;
  engagement_rate_ranking: string | null;
  conversion_rate_ranking: string | null;
}

export interface CreativeAngle {
  id: string;
  client_id: string;
  meta_entity_type: "campaign" | "adset" | "ad";
  meta_entity_id: string;
  angle_category: string | null;
  angle_label: string;
  hook_excerpt: string | null;
  format: string | null;
  asset_url: string | null;
  creation_origin: string | null;
  launch_date: string | null;
  status: string | null;
  first_seen_date: string | null;
  source: "manual" | "parsed";
  created_by: string | null;
  row_created_at: string;
  row_updated_at: string;
}

export interface SyncRun {
  id: string;
  client_id: string;
  run_type: string;
  status: "running" | "success" | "failed" | "partial";
  started_at: string;
  finished_at: string | null;
  entities_processed: number | null;
  error_message: string | null;
  rate_limit_usage_peak_percent: string | null;
}
