-- Row-Level Security: every table, no exceptions.
--
-- PREREQUISITE — enable Data API BEFORE running this migration: Neon's
-- Data API creates and configures the `authenticated` role itself (along
-- with the auth.user_id() helper this file uses below). An earlier version
-- of this migration created `authenticated` itself, which then made
-- Neon's "Enable Data API" button fail with "authenticated role already
-- exists" — confirmed the hard way on the real project this schema was
-- built for. Fixed by no longer creating that role at all: this migration
-- now assumes it already exists and fails loudly (see the guard below) if
-- it doesn't, instead of silently recreating the conflict. See
-- db/README.md "Setup" for the required order of operations, and
-- db/migrations/0011_authenticated_role_rebuild.sql for how the
-- already-affected project was fixed after the fact.
--
-- ROLE MODEL (see db/README.md "Security model" for the full writeup):
--   - The role this migration runs as (Neon's project owner role, e.g.
--     "neondb_owner") is the table OWNER of everything created here. Table
--     owners bypass RLS by default in Postgres UNLESS "FORCE ROW LEVEL
--     SECURITY" is set — this migration deliberately does NOT force it, so
--     the owner role keeps full admin access via psql/Neon's SQL console.
--     This is a trust boundary: hold the owner connection string as
--     tightly as you'd hold a superuser credential.
--   - "svc_sync": a non-owner role for the server-side sync job, created
--     by THIS migration (unaffected by the authenticated-role issue
--     above). Needs read/write across every client, unrestricted by
--     user_clients. NOT using BYPASSRLS here (uncertain whether Neon's
--     project-owner role can grant that attribute to another role on a
--     managed instance — unverified, not something to guess at in a
--     migration). Instead, every policy below explicitly ORs in
--     `current_user = 'svc_sync'`, which needs no elevated Postgres
--     privilege and works identically on any Postgres host.
--   - "authenticated": the role Neon's Data API (PostgREST) executes
--     browser requests as, scoped per-request by the caller's JWT (Neon
--     Auth). Created and configured by Neon itself, NOT by this migration
--     — see prerequisite above.
--
-- svc_sync is created WITH LOGIN but no password: set one manually via the
-- Neon SQL console (`ALTER ROLE svc_sync WITH PASSWORD '...'`) — never put
-- a real credential in a committed migration file. See db/README.md.
--
-- Idempotency note: CREATE POLICY has no IF NOT EXISTS / OR REPLACE form in
-- Postgres, so every policy below is preceded by DROP POLICY IF EXISTS —
-- that's what makes this file safe to re-run, not the migration runner's
-- own tracking table alone.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'svc_sync') THEN
    CREATE ROLE svc_sync WITH LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'Role "authenticated" does not exist. Enable the Data API in the Neon console first — it creates this role itself. See db/README.md "Setup".';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS app;

-- Neon's own identity helper (pg_session_jwt extension, provisioned
-- alongside the Data API/Neon Auth) — returns the JWT "sub" claim as text,
-- or NULL when there's no JWT in scope (e.g. svc_sync connecting
-- directly). Confirmed during this session: matches
-- neon_auth.users_sync.id's own type, so user_clients.user_id (text)
-- needs no cast anywhere here.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT auth.user_id();
$$;

-- True for svc_sync unconditionally, or for a browser user with a
-- user_clients grant for target_client_id. Deliberately not SECURITY
-- DEFINER: it queries user_clients as the calling role, which is safe
-- because the WHERE clause already pins the check to that same caller's
-- own user_id — user_clients' own RLS (below) can only narrow that further,
-- never widen it.
CREATE OR REPLACE FUNCTION app.has_client_access(target_client_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_user = 'svc_sync'
    OR EXISTS (
      SELECT 1 FROM user_clients uc
      WHERE uc.client_id = target_client_id
        AND uc.user_id = app.current_user_id()
    );
$$;

GRANT USAGE ON SCHEMA app TO svc_sync, authenticated;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO svc_sync, authenticated;
GRANT EXECUTE ON FUNCTION app.has_client_access(uuid) TO svc_sync, authenticated;

-- === clients =================================================================
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO svc_sync;
GRANT SELECT ON clients TO authenticated;

DROP POLICY IF EXISTS client_access_all ON clients;
CREATE POLICY client_access_all ON clients
  FOR ALL USING (app.has_client_access(id)) WITH CHECK (app.has_client_access(id));

-- === user_clients =============================================================
-- Not user-writable, even for a user's own rows: allowing self-service
-- writes here would let any authenticated user grant themselves access to
-- any client. Only svc_sync manages grants.
ALTER TABLE user_clients ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_clients TO svc_sync;
GRANT SELECT ON user_clients TO authenticated;

DROP POLICY IF EXISTS select_own_grants ON user_clients;
CREATE POLICY select_own_grants ON user_clients
  FOR SELECT USING (user_id = app.current_user_id() OR current_user = 'svc_sync');

DROP POLICY IF EXISTS sync_manages_grants ON user_clients;
CREATE POLICY sync_manages_grants ON user_clients
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

-- === ad_accounts (read-only for browser users) ===============================
ALTER TABLE ad_accounts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON ad_accounts TO svc_sync;
GRANT SELECT ON ad_accounts TO authenticated;

DROP POLICY IF EXISTS select_by_client_access ON ad_accounts;
CREATE POLICY select_by_client_access ON ad_accounts
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON ad_accounts;
CREATE POLICY sync_full_access ON ad_accounts
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

-- === campaigns_snapshot / adsets_snapshot / ads_snapshot (read-only) =========
ALTER TABLE campaigns_snapshot ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns_snapshot TO svc_sync;
GRANT SELECT ON campaigns_snapshot TO authenticated;
DROP POLICY IF EXISTS select_by_client_access ON campaigns_snapshot;
CREATE POLICY select_by_client_access ON campaigns_snapshot
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON campaigns_snapshot;
CREATE POLICY sync_full_access ON campaigns_snapshot
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

ALTER TABLE adsets_snapshot ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON adsets_snapshot TO svc_sync;
GRANT SELECT ON adsets_snapshot TO authenticated;
DROP POLICY IF EXISTS select_by_client_access ON adsets_snapshot;
CREATE POLICY select_by_client_access ON adsets_snapshot
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON adsets_snapshot;
CREATE POLICY sync_full_access ON adsets_snapshot
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

ALTER TABLE ads_snapshot ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON ads_snapshot TO svc_sync;
GRANT SELECT ON ads_snapshot TO authenticated;
DROP POLICY IF EXISTS select_by_client_access ON ads_snapshot;
CREATE POLICY select_by_client_access ON ads_snapshot
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON ads_snapshot;
CREATE POLICY sync_full_access ON ads_snapshot
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

-- Latest-state views: RLS on the underlying tables already applies since
-- views execute with the querying role's own permissions by default in
-- Postgres. They still need their own SELECT grant as view objects.
GRANT SELECT ON campaigns_latest, adsets_latest, ads_latest TO svc_sync, authenticated;

-- === creatives (read-only for browser users) =================================
ALTER TABLE creatives ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON creatives TO svc_sync;
GRANT SELECT ON creatives TO authenticated;
DROP POLICY IF EXISTS select_by_client_access ON creatives;
CREATE POLICY select_by_client_access ON creatives
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON creatives;
CREATE POLICY sync_full_access ON creatives
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

-- === creative_angles (the one browser-writable table: manual tagging) =======
ALTER TABLE creative_angles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON creative_angles TO svc_sync, authenticated;
DROP POLICY IF EXISTS client_access_all ON creative_angles;
CREATE POLICY client_access_all ON creative_angles
  FOR ALL USING (app.has_client_access(client_id)) WITH CHECK (app.has_client_access(client_id));

-- === insights_daily (read-only for browser users) ============================
ALTER TABLE insights_daily ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON insights_daily TO svc_sync;
GRANT SELECT ON insights_daily TO authenticated;
DROP POLICY IF EXISTS select_by_client_access ON insights_daily;
CREATE POLICY select_by_client_access ON insights_daily
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON insights_daily;
CREATE POLICY sync_full_access ON insights_daily
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

-- === optimization_reports / optimization_actions (read-only) ================
ALTER TABLE optimization_reports ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON optimization_reports TO svc_sync;
GRANT SELECT ON optimization_reports TO authenticated;
DROP POLICY IF EXISTS select_by_client_access ON optimization_reports;
CREATE POLICY select_by_client_access ON optimization_reports
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON optimization_reports;
CREATE POLICY sync_full_access ON optimization_reports
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

ALTER TABLE optimization_actions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON optimization_actions TO svc_sync;
GRANT SELECT ON optimization_actions TO authenticated;
DROP POLICY IF EXISTS select_by_client_access ON optimization_actions;
CREATE POLICY select_by_client_access ON optimization_actions
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON optimization_actions;
CREATE POLICY sync_full_access ON optimization_actions
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

-- === sync_runs / client_schedule_config (read-only for browser users) =======
-- Deliberately not user-writable: letting a browser user edit their own
-- schedule config or fabricate sync_runs rows directly would bypass any
-- future server-side validation. A future UI feature to let clients tweak
-- their own cadence should go through a server API, not a direct RLS grant.
ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_runs TO svc_sync;
GRANT SELECT ON sync_runs TO authenticated;
DROP POLICY IF EXISTS select_by_client_access ON sync_runs;
CREATE POLICY select_by_client_access ON sync_runs
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON sync_runs;
CREATE POLICY sync_full_access ON sync_runs
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

ALTER TABLE client_schedule_config ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_schedule_config TO svc_sync;
GRANT SELECT ON client_schedule_config TO authenticated;
DROP POLICY IF EXISTS select_by_client_access ON client_schedule_config;
CREATE POLICY select_by_client_access ON client_schedule_config
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON client_schedule_config;
CREATE POLICY sync_full_access ON client_schedule_config
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');
