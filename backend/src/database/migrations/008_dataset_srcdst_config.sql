-- Migration: Add gap-fill rollup config to datasets for SRC/DST Number Monitoring.
-- The dataset stores a per-day, per-number rollup (top-N/day) in AMS and serves reads instantly:
--   incremental_fill_days   — number of UTC days to retain (incl today); Stagegap-fill fills only
--                             missing days, re-pulls the last incremental_repull_days completed days,
--                             recomputes today, and prunes older days.
--   incremental_repull_days — most recent completed day(s) to re-pull each cycle (late CDRs).
--   row_limit               — top-N numbers stored per kind per day (via {{ROW_LIMIT}}).
-- All NULL for existing datasets → behaviour unchanged.
--
-- deploy.sh only runs migrations 001-003, so these columns are ALSO guaranteed idempotently in code
-- (StageService.onModuleInit + SrcDstNumberMonitoringService.ensureConfigColumns). Kept for parity.

ALTER TABLE datasets
  ADD COLUMN IF NOT EXISTS row_limit               INT,
  ADD COLUMN IF NOT EXISTS incremental_fill_days   INT,
  ADD COLUMN IF NOT EXISTS incremental_repull_days INT;
