-- Foundation: clients (the partitioning key for the entire database) and
-- user_clients (the access-grant table RLS is built on).
--
-- Idempotent: safe to re-run on a database where this migration already
-- applied (IF NOT EXISTS guards throughout).

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE clients IS
  'One row per GR AdLab client. Primary partitioning key for every other table in this database.';

-- user_clients: who (a Neon Auth user) can see/act on which client's data.
--
-- user_id is stored as text, not uuid: Neon Auth (backed by Stack Auth)
-- issues string user ids (e.g. "usr_..."), not native Postgres uuids. This
-- table is intentionally NOT writable by regular authenticated users (see
-- 0008_rls.sql) — only the sync/admin role can grant access, otherwise any
-- authenticated user could grant themselves access to any client.
CREATE TABLE IF NOT EXISTS user_clients (
  user_id text NOT NULL,
  client_id uuid NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id)
);

COMMENT ON TABLE user_clients IS
  'Access grants: which authenticated user can see which client. Backbone of every RLS policy in this database. Write access restricted to the sync/admin role — see db/README.md security model.';
COMMENT ON COLUMN user_clients.role IS
  'Free-text role label (e.g. "owner", "viewer"). Not enforced by a CHECK constraint yet — no differentiated permissions are implemented at this stage, this is just a label for future use.';

CREATE INDEX IF NOT EXISTS idx_user_clients_client_id ON user_clients (client_id);
