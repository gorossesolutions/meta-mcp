-- Creative assets (dimension table, not a daily snapshot — creatives are
-- effectively immutable once created in Meta, unlike delivery config) and
-- creative_angles (the fatigue-by-concept tracking layer on top of them).

CREATE TABLE IF NOT EXISTS creatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  ad_account_id uuid NOT NULL REFERENCES ad_accounts (id) ON DELETE CASCADE,
  meta_creative_id text NOT NULL,
  meta_ad_id text, -- the ad we observed this creative attached to; a creative could in principle be reused on other ads later
  name text,
  body text,
  title text,
  call_to_action_type text,
  image_url text,
  video_id text,
  thumbnail_url text,
  object_type text,
  object_story_spec jsonb, -- raw, for full fidelity (page/IG ids, full CTA payload, etc.)
  row_created_at timestamptz NOT NULL DEFAULT now(),
  row_updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ad_account_id, meta_creative_id)
);

COMMENT ON TABLE creatives IS
  'Creative assets, keyed by Meta creative id. Upserted on every sync so URLs stay fresh — see next comment.';
COMMENT ON COLUMN creatives.image_url IS
  'Meta CDN URLs (image_url, thumbnail_url) are signed and expire (observed "oe=" expiry param on real data during Etape 1) — do not treat a stored URL as permanently valid. Re-fetch/upsert on every sync rather than assuming staleness only matters for metrics.';

CREATE INDEX IF NOT EXISTS idx_creatives_client_id ON creatives (client_id);

-- creative_angles: one row per (Meta entity, angle) tagging. An "angle" is a
-- recurring creative concept that can reappear across many ads over time —
-- this table exists specifically so fatigue can be measured at the angle
-- level ("this angle is dead") rather than only at the single-ad level
-- ("this ad is fatigued").
--
-- MODELING DECISION (spec was ambiguous here, flagged for review): this is
-- one row per tagging instance, not a separate angle catalog + join table.
-- first_seen_date is intended to mean "the earliest date this angle_label
-- was seen for this client, across any entity" — maintaining that
-- invariant (copying the earliest date forward onto every new row sharing
-- the same angle_label) is sync/tagging-logic to build later, NOT enforced
-- by this schema (no trigger). The supporting index below is what makes
-- that future lookup cheap.
CREATE TABLE IF NOT EXISTS creative_angles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  meta_entity_type text NOT NULL CHECK (meta_entity_type IN ('campaign', 'adset', 'ad')),
  meta_entity_id text NOT NULL,
  angle_category text, -- free text, taxonomy will evolve — no enum
  angle_label text NOT NULL,
  hook_excerpt text,
  format text, -- free text (image/video/carousel/...), no enum — formats will expand
  asset_url text,
  creation_origin text, -- free text: which tool produced the visual
  launch_date date,
  status text, -- free text
  first_seen_date date, -- see modeling decision above
  source text NOT NULL CHECK (source IN ('manual', 'parsed')),
  created_by text, -- Neon Auth user id, when source = 'manual'
  row_created_at timestamptz NOT NULL DEFAULT now(),
  row_updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meta_entity_type, meta_entity_id)
);

COMMENT ON TABLE creative_angles IS
  'Angle tagging per Meta entity (ad/adset/campaign), one row per entity. See db/README.md for the first_seen_date maintenance contract and the manual-vs-parsed source model.';
COMMENT ON COLUMN creative_angles.source IS
  'This is an app-controlled value (not from Meta), so unlike Meta-sourced enum fields elsewhere in this database, constraining it to a fixed set is safe: it can never fail due to an upstream API change.';

CREATE INDEX IF NOT EXISTS idx_creative_angles_client_id ON creative_angles (client_id);
CREATE INDEX IF NOT EXISTS idx_creative_angles_label_lookup ON creative_angles (client_id, angle_label, first_seen_date);
