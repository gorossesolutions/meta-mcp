-- Meta ad accounts, one client can have several.

CREATE TABLE IF NOT EXISTS ad_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  meta_account_id text NOT NULL UNIQUE, -- e.g. "act_506096265438413"
  name text,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  timezone_name text NOT NULL,
  business_id text,
  business_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ad_accounts IS
  'Meta ad accounts, one row per act_XXXXXXXXXX, always attached to exactly one client.';
COMMENT ON COLUMN ad_accounts.currency IS
  'ISO 4217 code as returned by Meta (e.g. EUR, AED, CAD, MUR, USD). Every monetary column elsewhere in this database is stored in minor units (bigint) alongside its own currency column — never compare amounts across rows without checking currency first.';
COMMENT ON COLUMN ad_accounts.timezone_name IS
  'The account''s reporting timezone (e.g. "Indian/Mauritius"). Meta Insights dates (insights_daily.date) are calendar dates in THIS timezone, not UTC — see db/README.md.';

CREATE INDEX IF NOT EXISTS idx_ad_accounts_client_id ON ad_accounts (client_id);
