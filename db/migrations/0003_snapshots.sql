-- Point-in-time snapshots of campaigns, ad sets and ads. One row per entity
-- per capture day — re-running a sync on the same UTC day upserts the same
-- row rather than stacking duplicates (see natural-key unique constraints).
--
-- client_id is denormalized onto every table below (derivable via
-- ad_account_id -> ad_accounts.client_id) so RLS policies never need a join
-- to decide access — see db/README.md "Security model".
--
-- Enum-shaped fields coming straight from Meta (status, effective_status,
-- objective, bid_strategy, billing_event, optimization_goal,
-- learning_phase_status_raw) are stored as unconstrained `text`. Meta can
-- add/rename values across API versions; a CHECK constraint here would make
-- a sync fail on a value we've simply never seen yet. Only
-- learning_phase_status_normalized (a value THIS codebase computes, not
-- Meta) could safely be constrained, but is left unconstrained too so a bug
-- in the normalization logic can never block a sync either — see
-- db/README.md "Conventions" for the current normalization mapping.

CREATE TABLE IF NOT EXISTS campaigns_snapshot (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  ad_account_id uuid NOT NULL REFERENCES ad_accounts (id) ON DELETE CASCADE,
  meta_campaign_id text NOT NULL,
  captured_date date NOT NULL, -- UTC server date of the sync run, NOT account-local (this isn't a Meta Insights date) — see db/README.md
  name text,
  status_raw text,
  effective_status_raw text,
  objective_raw text,
  daily_budget_minor bigint,
  lifetime_budget_minor bigint,
  budget_remaining_minor bigint,
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  meta_start_time timestamptz,
  meta_stop_time timestamptz,
  meta_created_time timestamptz,
  meta_updated_time timestamptz,
  row_created_at timestamptz NOT NULL DEFAULT now(),
  row_updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ad_account_id, meta_campaign_id, captured_date)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_snapshot_client_date ON campaigns_snapshot (client_id, captured_date);

CREATE TABLE IF NOT EXISTS adsets_snapshot (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  ad_account_id uuid NOT NULL REFERENCES ad_accounts (id) ON DELETE CASCADE,
  meta_adset_id text NOT NULL,
  meta_campaign_id text NOT NULL, -- loose reference by Meta id, not FK: the parent campaign's own snapshot row is dated separately, see db/README.md
  captured_date date NOT NULL,
  name text,
  status_raw text,
  effective_status_raw text,
  billing_event_raw text,
  optimization_goal_raw text,
  bid_strategy_raw text,
  bid_amount_minor bigint,
  daily_budget_minor bigint,
  lifetime_budget_minor bigint,
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  targeting jsonb, -- raw Meta targeting spec, kept as-is for full fidelity and future diffing
  -- Learning phase (learning_stage_info) — see file header re: unconstrained status.
  -- All four columns are null whenever Meta doesn't populate the field, which
  -- happens whenever the ad set isn't actively delivering (effective_status
  -- != ACTIVE) — this is expected, not an error. Confirmed against a real
  -- account in this repo's Etape-1 session; see docs/AUDIT.md follow-up.
  learning_status_raw text,
  learning_status_normalized text, -- this codebase's mapping of learning_status_raw, see db/README.md
  learning_conversions integer,
  learning_last_significant_edit timestamptz,
  meta_start_time timestamptz,
  meta_end_time timestamptz,
  meta_created_time timestamptz,
  meta_updated_time timestamptz,
  row_created_at timestamptz NOT NULL DEFAULT now(),
  row_updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ad_account_id, meta_adset_id, captured_date)
);

CREATE INDEX IF NOT EXISTS idx_adsets_snapshot_client_date ON adsets_snapshot (client_id, captured_date);
CREATE INDEX IF NOT EXISTS idx_adsets_snapshot_campaign ON adsets_snapshot (meta_campaign_id);

CREATE TABLE IF NOT EXISTS ads_snapshot (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  ad_account_id uuid NOT NULL REFERENCES ad_accounts (id) ON DELETE CASCADE,
  meta_ad_id text NOT NULL,
  meta_adset_id text NOT NULL,
  meta_campaign_id text NOT NULL,
  meta_creative_id text, -- loose reference to creatives.meta_creative_id, see db/README.md
  captured_date date NOT NULL,
  name text,
  status_raw text,
  effective_status_raw text,
  meta_created_time timestamptz,
  meta_updated_time timestamptz,
  row_created_at timestamptz NOT NULL DEFAULT now(),
  row_updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ad_account_id, meta_ad_id, captured_date)
);

CREATE INDEX IF NOT EXISTS idx_ads_snapshot_client_date ON ads_snapshot (client_id, captured_date);
CREATE INDEX IF NOT EXISTS idx_ads_snapshot_adset ON ads_snapshot (meta_adset_id);

-- "Latest state" views: DISTINCT ON keeps the most recent captured_date per
-- entity, so the UI can query current config without knowing about the
-- snapshot-history mechanism at all. Views run with the querying role's own
-- permissions in Postgres, so RLS on the base tables applies here too — no
-- separate policy needed on the view itself.

CREATE OR REPLACE VIEW campaigns_latest AS
SELECT DISTINCT ON (ad_account_id, meta_campaign_id) *
FROM campaigns_snapshot
ORDER BY ad_account_id, meta_campaign_id, captured_date DESC;

CREATE OR REPLACE VIEW adsets_latest AS
SELECT DISTINCT ON (ad_account_id, meta_adset_id) *
FROM adsets_snapshot
ORDER BY ad_account_id, meta_adset_id, captured_date DESC;

CREATE OR REPLACE VIEW ads_latest AS
SELECT DISTINCT ON (ad_account_id, meta_ad_id) *
FROM ads_snapshot
ORDER BY ad_account_id, meta_ad_id, captured_date DESC;
