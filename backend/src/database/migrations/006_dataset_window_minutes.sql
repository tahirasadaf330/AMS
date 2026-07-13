-- Migration: Add configurable traffic window (minutes) to datasets.
-- Used by datasets whose SQL contains the {{WINDOW_MINUTES}} placeholder
-- (e.g. "Voice Live Traffic - Data"). NULL is treated as the default (10).
-- Allowed values enforced in application code: 10, 15, 20.

ALTER TABLE datasets
  ADD COLUMN IF NOT EXISTS window_minutes INT;

UPDATE datasets
  SET window_minutes = 10
  WHERE window_minutes IS NULL
    AND sql_query LIKE '%{{WINDOW_MINUTES}}%';
