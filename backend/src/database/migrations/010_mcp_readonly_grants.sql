-- 010: Read-only Postgres role for the AMS MCP server.
--
-- The MCP server connects as `ams_readonly` (NOT the app's full-privilege role), so Postgres
-- itself — not application code — is the source of truth for what an MCP client can read.
-- Sensitive tables are revoked entirely and re-exposed through owner-privilege "*_safe" views
-- that omit credentials/session/PII columns.
--
-- ⚠️ RUN AS A SUPERUSER, ONCE, and only after the role exists. It sets role-level defaults
-- (ALTER ROLE) and default privileges FOR the app's table-owning role, which require
-- superuser. This is intentionally NOT run by deploy.sh (which runs as the non-superuser app
-- role and would both fail the ALTER ROLE and, under `set -e`, abort the deploy). It only
-- needs to run once — grants persist and ALTER DEFAULT PRIVILEGES covers future stage tables.
--
--   1. As a superuser:  CREATE ROLE ams_readonly LOGIN PASSWORD '<generated>' CONNECTION LIMIT 10;
--   2. As a superuser:  psql -d AMS -f 010_mcp_readonly_grants.sql
-- Idempotent; safe to re-run.

DO $$
DECLARE app_owner text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ams_readonly') THEN
    RAISE EXCEPTION 'Role ams_readonly does not exist — create it first (see docs/mcp-server.md).';
  END IF;

  -- Connect + see the schema.
  EXECUTE 'GRANT CONNECT ON DATABASE ' || quote_ident(current_database()) || ' TO ams_readonly';
  GRANT USAGE ON SCHEMA public TO ams_readonly;

  -- Broad read grant, then an explicit deny-list. REVOKE removes SELECT on the sensitive
  -- tables so they vanish from information_schema for this role (clean list_tables).
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO ams_readonly;
  REVOKE ALL ON
    users, password_history, sessions, data_sources, settings,
    notification_log, audit_log, user_mcp_keys
  FROM ams_readonly;

  -- Stage/report tables are created at RUNTIME by the app's DB role (prod: ams_user; local:
  -- postgres). Default privileges must attach to THAT role so new tables are auto-readable —
  -- detect it from an existing app table rather than hardcoding, so this works in both envs.
  -- NOTE: this also auto-grants any FUTURE sensitive table that role creates — if one is
  -- added, add a REVOKE (see docs/mcp-server.md).
  SELECT tableowner INTO app_owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'datasets';
  IF app_owner IS NOT NULL THEN
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO ams_readonly', app_owner);
  END IF;

  -- Guardrails as role defaults (belt-and-suspenders with the app-side query wrap).
  ALTER ROLE ams_readonly SET statement_timeout = '8s';
  ALTER ROLE ams_readonly SET idle_in_transaction_session_timeout = '15s';
  ALTER ROLE ams_readonly SET default_transaction_read_only = on;
END $$;

-- ── Safe views (owned by the superuser/app owner → run with owner privileges, so
--    ams_readonly reads them without any grant on the base tables, and `SELECT *` works). ──

-- users: NO password_hash, NO oid (Entra identity key). group_id intentionally omitted
-- (added at runtime by the groups module; may not exist when this first runs).
CREATE OR REPLACE VIEW users_safe AS
  SELECT id, email, name, role, is_active, must_change_password,
         failed_login_count, locked_until, last_login, created_by, created_at
  FROM users;

-- data_sources: NO password (even encrypted, it is a live credential).
CREATE OR REPLACE VIEW data_sources_safe AS
  SELECT id, name, type, host, port, db, username, ssl_mode, is_active, created_by, created_at
  FROM data_sources;

-- notification_log: NO recipients / matched_rows (recipient PII + business-data snapshots).
CREATE OR REPLACE VIEW notification_log_safe AS
  SELECT id, condition_id, dataset_id, channel, matched_count, status,
         error_message, retry_count, last_retry_at, triggered_at
  FROM notification_log;

GRANT SELECT ON users_safe, data_sources_safe, notification_log_safe TO ams_readonly;
