-- Migration: Add rolling-overlap incremental config to datasets.
-- Used by datasets that opt into StageService's rolling-overlap mode (currently MT EDR
-- Monitoring): on first load the whole retention window is backfilled; each later cycle
-- re-pulls only the last `incremental_overlap_minutes` (by `incremental_timestamp_column`,
-- via the {{SINCE}} placeholder) so late-arriving updates (e.g. SMS DLRs) are captured
-- without reloading everything; rows older than `retention_days` are then pruned.
-- All NULL for existing datasets → behaviour unchanged.

ALTER TABLE datasets
  ADD COLUMN IF NOT EXISTS incremental_overlap_minutes  INT,
  ADD COLUMN IF NOT EXISTS incremental_timestamp_column VARCHAR(63),
  ADD COLUMN IF NOT EXISTS retention_days               INT;
