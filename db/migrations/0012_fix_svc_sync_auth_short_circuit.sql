-- Fixes a real regression found while verifying 0011 against the live
-- sync job: svc_sync started failing with "permission denied for schema
-- auth" on ordinary writes (e.g. bootstrapping a client row).
--
-- Root cause: app.current_user_id() now calls auth.user_id() (Neon's
-- Data API identity helper — see 0011). app.has_client_access() calls it
-- via `current_user = 'svc_sync' OR EXISTS (... app.current_user_id() ...)`.
-- Plain SQL boolean OR is NOT guaranteed to short-circuit past a subquery
-- the way procedural code does — confirmed the hard way: svc_sync (which
-- has no grant on Neon's `auth` schema, and shouldn't need one) hit the
-- permission error even though `current_user = 'svc_sync'` alone should
-- have made the rest irrelevant. Some policies (e.g. user_clients'
-- select_own_grants) call app.current_user_id() even earlier in the OR,
-- making the problem worse than a single call site.
--
-- Fix: make app.current_user_id() itself guarantee svc_sync never reaches
-- auth.user_id() at all, via PL/pgSQL's actual procedural control flow
-- (IF/RETURN executes sequentially — unlike SQL-language OR, this really
-- does guarantee auth.user_id() is never evaluated for svc_sync). One
-- fix at the source protects every policy/function that calls
-- app.current_user_id(), rather than auditing every OR's operand order.
--
-- svc_sync gets no grant on the `auth` schema here or anywhere — it
-- doesn't need one now, and shouldn't have one (least privilege).

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF current_user = 'svc_sync' THEN
    RETURN NULL;
  END IF;
  RETURN auth.user_id();
END;
$$;
