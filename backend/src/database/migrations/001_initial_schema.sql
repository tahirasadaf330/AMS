-- AMS Initial Schema Migration
-- Run this against the AMS PostgreSQL database

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'viewer',
  is_active BOOLEAN DEFAULT TRUE,
  must_change_password BOOLEAN DEFAULT TRUE,
  failed_login_count INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- password_history
CREATE TABLE IF NOT EXISTS password_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pwd_history ON password_history (user_id, changed_at DESC);

-- sessions
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  jti VARCHAR(255) UNIQUE NOT NULL,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id, expires_at DESC);

-- datasets
CREATE TABLE IF NOT EXISTS datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  source_db VARCHAR(64) NOT NULL DEFAULT 'jerasoft',
  sql_query TEXT NOT NULL,
  stage_table_name VARCHAR(128) UNIQUE NOT NULL,
  column_metadata JSONB,
  schedule_cron VARCHAR(128) DEFAULT '0 */6 * * *',
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- user_dataset_access
CREATE TABLE IF NOT EXISTS user_dataset_access (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  dataset_id UUID REFERENCES datasets(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, dataset_id)
);

-- dataset_refresh_log
CREATE TABLE IF NOT EXISTS dataset_refresh_log (
  id BIGSERIAL PRIMARY KEY,
  dataset_id UUID REFERENCES datasets(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL,
  row_count INTEGER,
  duration_ms INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_refresh_log ON dataset_refresh_log (dataset_id, started_at DESC);

-- stage_prepayment_cl
CREATE TABLE IF NOT EXISTS stage_prepayment_cl (
  id BIGSERIAL PRIMARY KEY,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company_name TEXT,
  carrier TEXT,
  account_manager TEXT,
  payment_term TEXT,
  current_balance NUMERIC(15,2),
  avg_daily_usage TEXT,
  yesterday_usage TEXT,
  days_to_consume_balance NUMERIC(10,0),
  balance_in_next_7_days NUMERIC(15,2),
  currency TEXT
);
CREATE INDEX IF NOT EXISTS idx_stage_prepayment_refreshed ON stage_prepayment_cl (refreshed_at DESC);

-- conditions
CREATE TABLE IF NOT EXISTS conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  dataset_id UUID REFERENCES datasets(id) ON DELETE CASCADE,
  logic VARCHAR(8) NOT NULL DEFAULT 'AND',
  condition_rows JSONB NOT NULL DEFAULT '[]',
  channels JSONB NOT NULL DEFAULT '{}',
  cooldown_minutes INTEGER DEFAULT 60,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- notification_log
CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condition_id UUID REFERENCES conditions(id) ON DELETE SET NULL,
  dataset_id UUID REFERENCES datasets(id) ON DELETE SET NULL,
  channel VARCHAR(32) NOT NULL,
  recipients JSONB,
  webhook_url TEXT,
  matched_rows JSONB,
  matched_count INTEGER,
  status VARCHAR(32) NOT NULL,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMPTZ,
  triggered_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_log_time ON notification_log (triggered_at DESC);

-- settings
CREATE TABLE IF NOT EXISTS settings (
  id BIGSERIAL PRIMARY KEY,
  key VARCHAR(128) UNIQUE NOT NULL,
  value TEXT,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- audit_log
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  action VARCHAR(128) NOT NULL,
  resource VARCHAR(128),
  detail JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_time ON audit_log (created_at DESC);

-- Seed: PrePayment CL dataset
INSERT INTO datasets (name, description, source_db, sql_query, stage_table_name, schedule_cron, is_active)
VALUES (
  'PrePayment CL',
  'PrePayment client balance monitoring — tracks current balance, daily usage, and projected consumption for prepayment clients',
  'jerasoft',
  $SQL$WITH usage_stats AS (
  SELECT
    clients_id,
    ABS(SUM(CASE WHEN dt::date = CURRENT_DATE - 1 THEN cost_net ELSE 0 END)) AS yesterday_usage,
    ABS(SUM(CASE WHEN dt::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE - 1 THEN cost_net ELSE 0 END)) / 7.0 AS avg_daily_usage
  FROM public.xdrs_billed
  WHERE clients_id IN (SELECT id FROM public.clients WHERE id IN (699, 1054, 1067, 1070, 1220))
    AND dt >= CURRENT_DATE - 7
  GROUP BY clients_id
)
SELECT
  c.c_company AS "Company Name",
  le.name AS "Carrier",
  u.fullname AS "Account Manager",
  pt.name AS "Payment Term",
  ROUND(cb.balance::numeric, 2) * -1 AS "Current Balance",
  CASE WHEN COALESCE(u2.avg_daily_usage, 0) = 0 THEN 'No Usage for last 7 days' ELSE ROUND(u2.avg_daily_usage::numeric, 2)::text END AS "Avg Daily Usage (Last 7 days)",
  CASE WHEN COALESCE(u2.yesterday_usage, 0) = 0 THEN '' ELSE ROUND(u2.yesterday_usage::numeric, 2)::text END AS "Yesterday Usage",
  CASE WHEN COALESCE(u2.avg_daily_usage, 0) = 0 THEN NULL ELSE ROUND(((c.credit + cb.balance) / u2.avg_daily_usage)::numeric, 0) * -1 END AS "Days to Consume all Balance",
  CASE WHEN COALESCE(u2.avg_daily_usage, 0) = 0 THEN ROUND((cb.balance * -1)::numeric, 2) ELSE ROUND(((cb.balance) + (u2.avg_daily_usage * 7))::numeric, 2) * -1 END AS "Balance in Next 7 Days",
  cur.name AS "Currency"
FROM public.clients c
JOIN public.clients_balances cb ON cb.clients_id = c.id
JOIN public.currencies cur ON cur.id = c.currencies_id
JOIN system.auth_users u ON u.id = c.owner_users_id
LEFT JOIN public.legal_entities le ON le.id = c.legal_entities_id
LEFT JOIN public.payment_terms pt ON pt.id = c.payment_terms_id
LEFT JOIN usage_stats u2 ON u2.clients_id = c.id
WHERE c.id IN (699, 1054, 1067, 1070, 1220)
ORDER BY c.c_company$SQL$,
  'stage_prepayment_cl',
  '0 */6 * * *',
  true
)
ON CONFLICT (name) DO NOTHING;
