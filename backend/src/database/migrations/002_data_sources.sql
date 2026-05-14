-- Migration: Add data_sources table and link datasets to a data source

CREATE TABLE IF NOT EXISTS data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(128) NOT NULL UNIQUE,
  type VARCHAR(32) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL,
  db VARCHAR(128) NOT NULL,
  username VARCHAR(128) NOT NULL,
  password TEXT,
  ssl_mode VARCHAR(32) NOT NULL DEFAULT 'prefer',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add optional FK from datasets to data_sources
-- NULL means "use the legacy Jerasoft connection"
ALTER TABLE datasets
  ADD COLUMN IF NOT EXISTS data_source_id UUID REFERENCES data_sources(id) ON DELETE SET NULL;
