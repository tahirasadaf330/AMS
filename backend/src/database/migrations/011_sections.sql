-- 011: Dataset SMS/Voice section + permission collapse (full_rights -> editor).
-- Idempotent; safe to re-run. Report sections are code-defined (@ReportAccess). Dataset sections
-- live in the DB. Run on the host Postgres (deploy.sh / manual). See docs & the roles redesign plan.

ALTER TABLE datasets ADD COLUMN IF NOT EXISTS section VARCHAR(16);

-- Classify existing datasets (2026-08 mapping: Mashhood=Voice, Hassan=SMS; Apple + Zamani = SMS;
-- PrePayment/Voice AM's Profit = Voice). trim() handles a trailing space in "Voice AM's Profit ".
UPDATE datasets SET section = 'voice' WHERE section IS NULL AND trim(name) IN (
  'Voice Credit Limit','Voice Live Traffic - Data','Voice Negative Margin','Deals Automation',
  'Pre-Payment Limit','PrePayment CL','SRC/DST Number Monitoring - Data','Vendor Credit Limit',
  'Voice AM''s Profit'
);
UPDATE datasets SET section = 'sms' WHERE section IS NULL AND trim(name) IN (
  'SMS Report','SMS Credit Limit','MT EDR Monitoring','Google MO Traffic','Zamani Traffic',
  'Zamani Sender ID','Apple Traffic History','Apple Traffic Live'
);

-- Permissions collapse: full_rights folds into editor (Viewer/Editor/Admin).
UPDATE users SET role = 'editor' WHERE role = 'full_rights';
