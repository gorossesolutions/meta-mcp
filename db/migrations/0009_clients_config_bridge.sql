-- Bridges a Neon `clients` row to the accounts.config.json entry it
-- corresponds to. The sync job's --client flag takes this slug (the same
-- client_id string already used everywhere else in this repo — MCP tools'
-- client_id param, accounts.config.json's client_id field), not a Neon uuid.
--
-- DECISION (not explicitly asked for, but required to make "select one
-- client" implementable against accounts.config.json — see db/README.md):
-- the sync job is the only thing that ever creates `clients` rows (RLS
-- already restricts INSERT on `clients` to svc_sync), upserting one per
-- accounts.config.json entry keyed on this column. No Meta token or secret
-- lives here — only the free-text slug already used to select credentials
-- in accounts.config.json.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS config_client_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_config_client_id_key'
  ) THEN
    ALTER TABLE clients ADD CONSTRAINT clients_config_client_id_key UNIQUE (config_client_id);
  END IF;
END
$$;

COMMENT ON COLUMN clients.config_client_id IS
  'The client_id slug from accounts.config.json this Neon client was bootstrapped from. Set once by the sync job, not user-facing.';
