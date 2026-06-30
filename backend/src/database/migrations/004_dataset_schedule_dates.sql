-- Migration: Add schedule date range columns to datasets, is_protected to users

ALTER TABLE datasets
  ADD COLUMN IF NOT EXISTS schedule_start_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS schedule_end_date TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_protected BOOLEAN NOT NULL DEFAULT false;
