-- 010: Read-only Postgres role for the AMS MCP server.
--
-- The MCP server connects as `ams_readonly` (NOT the app's full-privilege ams_user), so
-- Postgres itself — not application code — is the source of truth for what an MCP client
-- can read. Sensitive tables are revoked entirely and re-exposed through owner-privilege
-- "*_safe" views that omit credentials/session/PII columns.
--
-- ORDER OF OPERATIONS:
--   1. Create the role ONCE, manually, as a superuser (it needs a password; we never
--      commit passwords):  CREATE ROLE ams_readonly LOGIN PASSWORD '<generated>' CONNECTION LIMIT 10;
--   2. Then run THIS migration as ams_user (the owner of every table/view in public).
-- This script is idempotent and safe to re-run. If the role is missing it no-ops with a notice.
--
-- Run as ams_user:
--   PGPASSWORD=... psql -U ams_user -d AMS -h localhost -f 010_mcp_readonly_grants.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ams_readonly') THEN
    RAISE NOTICE 'Role ams_readonly does not exist — create it first (see docs/mcp-server.md). Skipping grants.';
    RETURN;
  END IF;

  -- Connect + see the schema.
  GRANT CONNECT ON DATABASE "AMS" TO ams_readonly;
  GRANT USAGE ON SCHEMA public TO ams_readonly;

  -- Broad read grant, then an explicit deny-list. REVOKE removes SELECT on the sensitive
  -- tables so they vanish from information_schema for this role (clean list_tables).
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO ams_readonly;
  REVOKE ALL ON
    users, password_history, sessions, data_sources, settings,
    notification_log, audit_log, user_mcp_keys
  FROM ams_readonly;

  -- Stage/report tables are created at RUNTIME by the app's DB role (dataset refreshes,
  -- admin datasets). Default privileges make every future table created BY THE ROLE RUNNING
  -- THIS MIGRATION auto-readable — which is the same role the backend connects as (prod:
  -- ams_user; local: postgres), so new datasets appear in MCP with no re-grant. No FOR ROLE
  -- clause on purpose, so it stays correct across environments.
  -- NOTE: this also auto-grants any FUTURE sensitive table — if one is added, add a REVOKE
  -- here (see docs/mcp-server.md).
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO ams_readonly;

  -- Guardrails as role defaults (belt-and-suspenders with the app-side query wrap).
  ALTER ROLE ams_readonly SET statement_timeout = '8s';
  ALTER ROLE ams_readonly SET idle_in_transaction_session_timeout = '15s';
  ALTER ROLE ams_readonly SET default_transaction_read_only = on;
END $$;

-- ── Safe views (owned by ams_user → run with owner privileges, so ams_readonly reads them
--    without any grant on the underlying base tables, and `SELECT *` works cleanly). ──

-- users: NO password_hash, NO oid (Entra identity key). group_id intentionally omitted
-- (added at runtime by the groups module; may not exist when this migration first runs).
CREATE OR REPLACE VIEW users_safe AS
  SELECT id, email, name, role, is_active, must_change_password,
         failed_login_count, locked_until, last_login, created_by, created_at
  FROM users;

-- data_sources: NO password (even though encrypted, it is a live credential).
CREATE OR REPLACE VIEW data_sources_safe AS
  SELECT id, name, type, host, port, db, username, ssl_mode, is_active, created_by, created_at
  FROM data_sources;

-- notification_log: NO recipients / matched_rows (recipient PII + business-data snapshots).
CREATE OR REPLACE VIEW notification_log_safe AS
  SELECT id, condition_id, dataset_id, channel, matched_count, status,
         error_message, retry_count, last_retry_at, triggered_at
  FROM notification_log;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ams_readonly') THEN
    GRANT SELECT ON users_safe, data_sources_safe, notification_log_safe TO ams_readonly;
  END IF;
END $$;
