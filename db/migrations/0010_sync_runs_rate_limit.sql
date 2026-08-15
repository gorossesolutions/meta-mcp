-- Tracks the peak Meta rate-limit usage percentage observed during a sync
-- run (from the X-Business-Use-Case-Usage response header), so Guillaume
-- can see how close to the limit he's running as he adds clients.

ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS rate_limit_usage_peak_percent numeric;

COMMENT ON COLUMN sync_runs.rate_limit_usage_peak_percent IS
  'Highest X-Business-Use-Case-Usage percentage observed across all Meta API calls made during this run. Null if the header was never present (e.g. account not tied to a Business Manager use case).';
