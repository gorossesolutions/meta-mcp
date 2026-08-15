-- Operational tables: sync run log (so a silent failure is never actually
-- silent) and per-client scheduling config.

CREATE TABLE IF NOT EXISTS sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  run_type text NOT NULL, -- free text (e.g. "full_sync", "insights_only") — vocabulary will grow, not constrained
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'partial')), -- our own pipeline's status vocabulary, small and stable — safe to constrain
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  entities_processed integer,
  error_message text,
  CHECK (finished_at IS NULL OR finished_at >= started_at)
);

COMMENT ON TABLE sync_runs IS
  'Log of every sync attempt, one row per client per run. A run stuck at status=''running'' past a reasonable duration is itself a signal something crashed without reporting.';

CREATE INDEX IF NOT EXISTS idx_sync_runs_client_started ON sync_runs (client_id, started_at DESC);

CREATE TABLE IF NOT EXISTS client_schedule_config (
  client_id uuid PRIMARY KEY REFERENCES clients (id) ON DELETE CASCADE,
  frequency_days integer NOT NULL DEFAULT 1 CHECK (frequency_days > 0),
  enabled boolean NOT NULL DEFAULT true,
  run_time time NOT NULL DEFAULT '06:00',
  threshold_overrides jsonb, -- client-specific overrides of the pipeline's default thresholds, null = use defaults
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE client_schedule_config IS
  'One row per client (1:1), created on client onboarding. Governs the future scheduler''s cadence per client — no scheduler exists yet, this is config only.';
