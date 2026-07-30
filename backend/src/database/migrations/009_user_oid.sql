-- 009: Microsoft Entra SSO — permanent Microsoft Object ID (oid) on users.
-- The oid is the cross-app identity key (never changes, unlike email). It is written
-- once on a user's first successful SSO login (matched by email) and used for every
-- login after that. Nullable: users who have never signed in via SSO have no oid.
ALTER TABLE users ADD COLUMN IF NOT EXISTS oid VARCHAR(64);
-- Unique across users that HAVE one (partial index so multiple NULLs are fine).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oid ON users (oid) WHERE oid IS NOT NULL;
