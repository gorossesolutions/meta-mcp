-- Daily performance metrics. By far the highest-volume table in this
-- database — see retention strategy at the bottom of this file and in
-- db/README.md.
--
-- BREAKDOWN DESIGN DECISION: Meta's Insights API supports combining several
-- breakdown dimensions (age, gender, platform, placement, device, country)
-- in a single request, producing one row per combination of dimension
-- values. Rather than one table per breakdown (would "exploser en tables
-- séparées", explicitly ruled out) or a single jsonb breakdown blob (would
-- break the idempotent-upsert requirement, since jsonb can't participate
-- cleanly in a UNIQUE constraint the way we need), every breakdown
-- dimension is its own nullable-in-spirit column — but declared NOT NULL
-- DEFAULT '' instead of nullable. Postgres UNIQUE constraints treat NULL as
-- "distinct from every other NULL", which would silently defeat
-- upsert-idempotency for any row with an unset breakdown dimension (the
-- single most common case: no breakdown at all). An empty string sentinel
-- ('' = "not broken down by this dimension") sidesteps that pitfall
-- entirely and keeps ON CONFLICT upserts simple and correct.
--
-- date is the Meta Insights date (date_start), a calendar date in the ad
-- account's own reporting timezone (ad_accounts.timezone_name) — NOT UTC,
-- and deliberately typed `date` rather than `timestamptz` so no timezone
-- reinterpretation can ever happen by accident.

CREATE TABLE IF NOT EXISTS insights_daily (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  ad_account_id uuid NOT NULL REFERENCES ad_accounts (id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('account', 'campaign', 'adset', 'ad')), -- our own concept (mirrors get_insights' `level`), not a raw Meta field — safe to constrain
  meta_entity_id text NOT NULL, -- the account/campaign/adset/ad id itself
  date date NOT NULL,

  -- Breakdown dimensions — see file header. '' means "not broken down by this dimension".
  breakdown_age text NOT NULL DEFAULT '',
  breakdown_gender text NOT NULL DEFAULT '',
  breakdown_publisher_platform text NOT NULL DEFAULT '',
  breakdown_platform_position text NOT NULL DEFAULT '',
  breakdown_impression_device text NOT NULL DEFAULT '',
  breakdown_device_platform text NOT NULL DEFAULT '',
  breakdown_region text NOT NULL DEFAULT '',
  breakdown_country text NOT NULL DEFAULT '',

  -- Core metrics
  impressions bigint NOT NULL DEFAULT 0,
  reach bigint,
  frequency numeric,
  clicks bigint NOT NULL DEFAULT 0,
  inline_link_clicks bigint,
  ctr numeric,
  cpc_minor bigint,
  cpm_minor bigint,
  spend_minor bigint NOT NULL DEFAULT 0,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

  -- Action/conversion payloads: Meta returns these as arrays of
  -- {action_type, value} with an open-ended, evolving set of action_type
  -- values — jsonb keeps full fidelity without a column per action type.
  actions jsonb,
  action_values jsonb,
  cost_per_action_type jsonb,
  purchase_roas jsonb,

  -- Ad relevance diagnostics — only meaningful at entity_type = 'ad', null
  -- otherwise. Raw, unconstrained: confirmed in Etape 1 to return the
  -- literal string "UNKNOWN" below ~500 impressions, and Meta owns this
  -- vocabulary, not us.
  quality_ranking text,
  engagement_rate_ranking text,
  conversion_rate_ranking text,

  row_created_at timestamptz NOT NULL DEFAULT now(),
  row_updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (
    ad_account_id, entity_type, meta_entity_id, date,
    breakdown_age, breakdown_gender, breakdown_publisher_platform,
    breakdown_platform_position, breakdown_impression_device,
    breakdown_device_platform, breakdown_region, breakdown_country
  )
);

COMMENT ON TABLE insights_daily IS
  'Daily performance metrics, one row per entity/date/breakdown-combination. Highest-volume table by far — see retention strategy comment below and db/README.md.';

-- The UNIQUE constraint above already provides an index whose leading
-- columns (ad_account_id, entity_type, meta_entity_id, date) cover the most
-- common query pattern ("trend for one entity"), so no redundant index for
-- that. client_id is NOT a leading column there, so the UI's "all of a
-- client's insights in a date range" query needs its own index.
CREATE INDEX IF NOT EXISTS idx_insights_daily_client_date ON insights_daily (client_id, date DESC);

-- RETENTION STRATEGY (not implemented in this migration — schema-only
-- session, no scheduled job exists yet; documented here so it's designed
-- before it's urgent):
--   - Rows with no breakdown at all (all breakdown_* = '') are the ones
--     trend charts and the analysis pipeline depend on long-term — keep
--     these the longest (e.g. 24 months, revisit once real volume is known).
--   - Rows WITH a breakdown set (any breakdown_* <> '') are primarily used
--     for near-term diagnostic questions ("which age group is underperforming
--     this month") and are the biggest combinatorial storage risk — prune or
--     roll up aggressively (e.g. 90 days) unless a concrete need for older
--     breakdown history shows up.
--   - Watch combinatorial blow-up specifically: requesting multiple
--     breakdown dimensions at once for every entity every day multiplies
--     row count by the cartesian product of dimension values, not by the
--     entity count. Keep the daily baseline sync to zero or one breakdown
--     dimension; pull richer breakdown combinations on demand instead of on
--     a schedule.
