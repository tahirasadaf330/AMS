-- 012: One-time migration of existing users onto the four Roles (SMS/Voice × Viewer/Editor).
--
-- ADDITIVE and NON-DESTRUCTIVE: it only INSERTs user_roles rows. It never deletes individual
-- grants (user_report_access / user_dataset_access), never lowers anyone's permission, and never
-- touches admins. Idempotent (ON CONFLICT DO NOTHING) — safe to re-run.
--
-- Run AFTER the app has booted once (the boot AccessSeedService creates user_roles + the 4 roles
-- and classifies dataset sections). A user's section(s) are inferred from the reports/datasets they
-- can currently reach (individually or via their legacy group); their level is their stored role
-- (editor → *-Editor role, which then auto-grants the whole section; viewer → *-Viewer role, which
-- keeps their existing per-item grants). Users with no section-identifiable grants get no role and
-- keep exactly what they had.

WITH report_section(slug, section) AS (VALUES
  ('mt-edr','sms'), ('apple-traffic','sms'), ('zamani-sender-id','sms'), ('google_mo','sms'),
  ('sms-credit-limit','sms'), ('sms-report','sms'), ('zamani','sms'),
  ('negative-margin','voice'), ('deals-automation','voice'), ('src-dst-number-monitoring','voice'),
  ('prepayment-cl','voice'), ('voice-live-traffic','voice'), ('vcs-balance','voice')
),
grants(user_id, section) AS (
  -- individual report grants
  SELECT ura.user_id, rs.section
    FROM user_report_access ura JOIN report_section rs ON rs.slug = ura.report_slug
  UNION
  -- individual dataset grants
  SELECT uda.user_id, d.section
    FROM user_dataset_access uda JOIN datasets d ON d.id = uda.dataset_id
   WHERE d.section IS NOT NULL
  UNION
  -- legacy group report grants
  SELECT u.id, rs.section
    FROM users u
    JOIN group_report_access gra ON gra.group_id = u.group_id
    JOIN report_section rs ON rs.slug = gra.report_slug
  UNION
  -- legacy group dataset grants
  SELECT u.id, d.section
    FROM users u
    JOIN group_dataset_access gda ON gda.group_id = u.group_id
    JOIN datasets d ON d.id = gda.dataset_id
   WHERE d.section IS NOT NULL
),
user_sections AS (
  SELECT DISTINCT u.id AS user_id,
         CASE WHEN u.role = 'editor' THEN 'editor' ELSE 'viewer' END AS lvl,
         g.section
    FROM users u
    JOIN grants g ON g.user_id = u.id
   WHERE u.role <> 'admin'
)
INSERT INTO user_roles (user_id, role_id)
SELECT us.user_id, r.id
  FROM user_sections us
  JOIN user_groups r ON r.section = us.section AND r.level = us.lvl
ON CONFLICT DO NOTHING;

-- Print the resulting per-user mapping for review.
SELECT u.email,
       u.role AS permission,
       COALESCE(string_agg(DISTINCT g.name, ', ' ORDER BY g.name), '(no roles — individual grants only)') AS roles
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN user_groups g ON g.id = ur.role_id
 GROUP BY u.id, u.email, u.role
 ORDER BY (u.role = 'admin') DESC, u.role, u.email;
