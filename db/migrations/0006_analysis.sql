-- Optimization reports (one per client per analysis run) and the
-- normalized actions extracted from them, so the UI can filter/sort
-- recommendations without parsing jsonb client-side.

CREATE TABLE IF NOT EXISTS optimization_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  report_date date NOT NULL,
  summary text,
  payload jsonb NOT NULL, -- full report as produced by the pipeline, kept for audit/debugging
  model_used text,
  playbook_version text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, report_date)
);

COMMENT ON TABLE optimization_reports IS
  'One row per client per analysis run. UNIQUE(client_id, report_date) prevents duplicate runs on the same day from stacking.';

CREATE INDEX IF NOT EXISTS idx_optimization_reports_client_date ON optimization_reports (client_id, report_date DESC);

CREATE TABLE IF NOT EXISTS optimization_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES optimization_reports (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE, -- denormalized from the report for RLS simplicity, same pattern as every other table
  priority text, -- free text (e.g. "urgent"/"watch"/"info") — app convention, documented in db/README.md, not enforced here
  entity_type text CHECK (entity_type IN ('account', 'campaign', 'adset', 'ad')),
  entity_id text,
  problem text,
  recommendation text,
  expected_impact text,
  category text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE optimization_actions IS
  'Normalized, filterable recommendations extracted from optimization_reports.payload. One report can have many actions.';

CREATE INDEX IF NOT EXISTS idx_optimization_actions_report_id ON optimization_actions (report_id);
CREATE INDEX IF NOT EXISTS idx_optimization_actions_client_id ON optimization_actions (client_id);
