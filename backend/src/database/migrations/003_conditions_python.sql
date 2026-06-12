-- Migration: Add Python alert support and scheduling columns to conditions

ALTER TABLE conditions
  ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'dataset',
  ADD COLUMN IF NOT EXISTS python_script TEXT,
  ADD COLUMN IF NOT EXISTS trigger_cron VARCHAR(100),
  ADD COLUMN IF NOT EXISTS last_triggered_at TIMESTAMPTZ;
