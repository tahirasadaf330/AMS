-- 013: SMS/Voice section on conditions (alerts). Idempotent.
-- Dataset alerts derive their section from their dataset at query time; the stored column is
-- what scopes PYTHON alerts (no dataset link). Fixes voice editors seeing SMS python alerts.

ALTER TABLE conditions ADD COLUMN IF NOT EXISTS section VARCHAR(16);

-- Backfill dataset alerts from their dataset (kept in sync by the app on create/update).
UPDATE conditions c SET section = d.section
  FROM datasets d
 WHERE c.dataset_id = d.id AND c.section IS NULL AND d.section IS NOT NULL;

-- Classify existing seeded/system PYTHON alerts by origin (all current ones are SMS-side:
-- Zamani* + Google MO seeders, AM Weekly Volume lives in the sms-report module, Supreme is
-- an SMS customer-volume script).
UPDATE conditions SET section = 'sms'
 WHERE section IS NULL AND type = 'python'
   AND (name ILIKE 'Zamani%' OR name ILIKE 'Google MO%'
        OR name ILIKE 'Weekly Volume Alert%' OR name = 'Supreme System Ltd');
