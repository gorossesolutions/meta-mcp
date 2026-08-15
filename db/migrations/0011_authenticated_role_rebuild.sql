-- Rebuilds everything the `authenticated` role needs, AFTER Neon's Data
-- API has created that role itself. Never attempts to CREATE ROLE
-- authenticated — that's now Neon's job, not ours (see file header of
-- 0008_rls.sql for why the original version of this migration conflicted
-- with "Enable Data API").
--
-- Sequence to apply this migration:
--   1. Run db/teardown-authenticated-role.ts --yes (drops the role 0008
--      originally created, and everything granted to it — nothing else).
--   2. Enable Data API in the Neon console. Neon creates `authenticated`
--      with its own configuration.
--   3. npm run db:migrate (applies this file, among any others pending).
--
-- Also switches identity resolution from manually parsing
-- request.jwt.claims to Neon's own auth.user_id() helper (pg_session_jwt
-- extension, provisioned alongside Data API/Neon Auth). Verified during
-- this session: auth.user_id() returns text and matches
-- neon_auth.users_sync.id's own type — user_clients.user_id (already
-- `text`) needs no column change.
--
-- svc_sync is entirely untouched by this migration — not a single
-- statement below references it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'Role "authenticated" does not exist. Enable the Data API in the Neon console first — it creates this role itself. See db/README.md.';
  END IF;
END
$$;

-- Was: manually parsing current_setting('request.jwt.claims', true).
-- Now: Neon's own helper. app.has_client_access() calls this function and
-- needs no change itself.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT auth.user_id();
$$;

GRANT USAGE ON SCHEMA app TO authenticated;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION app.has_client_access(uuid) TO authenticated;

GRANT SELECT ON clients TO authenticated;
GRANT SELECT ON user_clients TO authenticated;
GRANT SELECT ON ad_accounts TO authenticated;
GRANT SELECT ON campaigns_snapshot TO authenticated;
GRANT SELECT ON adsets_snapshot TO authenticated;
GRANT SELECT ON ads_snapshot TO authenticated;
GRANT SELECT ON campaigns_latest, adsets_latest, ads_latest TO authenticated;
GRANT SELECT ON creatives TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON creative_angles TO authenticated;
GRANT SELECT ON insights_daily TO authenticated;
GRANT SELECT ON optimization_reports TO authenticated;
GRANT SELECT ON optimization_actions TO authenticated;
GRANT SELECT ON sync_runs TO authenticated;
GRANT SELECT ON client_schedule_config TO authenticated;

-- Policies technically survive a role drop/recreate untouched (none use a
-- `TO authenticated` clause — every one gates on app.has_client_access()
-- or current_user = 'svc_sync', evaluated per-caller, not tied to a role
-- object Postgres tracks a dependency on). Re-issued here anyway so this
-- migration is a complete, self-contained rebuild of the authenticated
-- side of RLS, matching db/migrations/0008_rls.sql exactly minus the role
-- creation and svc_sync-specific statements.

DROP POLICY IF EXISTS client_access_all ON clients;
CREATE POLICY client_access_all ON clients
  FOR ALL USING (app.has_client_access(id)) WITH CHECK (app.has_client_access(id));

DROP POLICY IF EXISTS select_own_grants ON user_clients;
CREATE POLICY select_own_grants ON user_clients
  FOR SELECT USING (user_id = app.current_user_id() OR current_user = 'svc_sync');
DROP POLICY IF EXISTS sync_manages_grants ON user_clients;
CREATE POLICY sync_manages_grants ON user_clients
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

DROP POLICY IF EXISTS select_by_client_access ON ad_accounts;
CREATE POLICY select_by_client_access ON ad_accounts
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON ad_accounts;
CREATE POLICY sync_full_access ON ad_accounts
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

DROP POLICY IF EXISTS select_by_client_access ON campaigns_snapshot;
CREATE POLICY select_by_client_access ON campaigns_snapshot
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON campaigns_snapshot;
CREATE POLICY sync_full_access ON campaigns_snapshot
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

DROP POLICY IF EXISTS select_by_client_access ON adsets_snapshot;
CREATE POLICY select_by_client_access ON adsets_snapshot
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON adsets_snapshot;
CREATE POLICY sync_full_access ON adsets_snapshot
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

DROP POLICY IF EXISTS select_by_client_access ON ads_snapshot;
CREATE POLICY select_by_client_access ON ads_snapshot
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON ads_snapshot;
CREATE POLICY sync_full_access ON ads_snapshot
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

DROP POLICY IF EXISTS select_by_client_access ON creatives;
CREATE POLICY select_by_client_access ON creatives
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON creatives;
CREATE POLICY sync_full_access ON creatives
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

DROP POLICY IF EXISTS client_access_all ON creative_angles;
CREATE POLICY client_access_all ON creative_angles
  FOR ALL USING (app.has_client_access(client_id)) WITH CHECK (app.has_client_access(client_id));

DROP POLICY IF EXISTS select_by_client_access ON insights_daily;
CREATE POLICY select_by_client_access ON insights_daily
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON insights_daily;
CREATE POLICY sync_full_access ON insights_daily
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

DROP POLICY IF EXISTS select_by_client_access ON optimization_reports;
CREATE POLICY select_by_client_access ON optimization_reports
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON optimization_reports;
CREATE POLICY sync_full_access ON optimization_reports
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

DROP POLICY IF EXISTS select_by_client_access ON optimization_actions;
CREATE POLICY select_by_client_access ON optimization_actions
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON optimization_actions;
CREATE POLICY sync_full_access ON optimization_actions
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

DROP POLICY IF EXISTS select_by_client_access ON sync_runs;
CREATE POLICY select_by_client_access ON sync_runs
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON sync_runs;
CREATE POLICY sync_full_access ON sync_runs
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');

DROP POLICY IF EXISTS select_by_client_access ON client_schedule_config;
CREATE POLICY select_by_client_access ON client_schedule_config
  FOR SELECT USING (app.has_client_access(client_id));
DROP POLICY IF EXISTS sync_full_access ON client_schedule_config;
CREATE POLICY sync_full_access ON client_schedule_config
  FOR ALL USING (current_user = 'svc_sync') WITH CHECK (current_user = 'svc_sync');
