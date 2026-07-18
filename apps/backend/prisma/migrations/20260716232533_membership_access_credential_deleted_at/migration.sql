-- DATA IMPACT:
-- Tables affected:
--   membership_access_credentials -> adds nullable `deleted_at TIMESTAMP`
-- Expected row changes: NONE. Existing rows keep `deleted_at = NULL`
--   (interpreted as "not archived"); the column is purely additive.
-- Destructive operations: NONE. No DELETE / UPDATE / TRUNCATE / DROP COLUMN.
--   The partial unique index `membership_access_cred_active_uq` (created by
--   20260708120000_membership_access_credential_active_unique) is NOT touched:
--   archiving a credential sets BOTH `is_active = false` AND `deleted_at = now()`,
--   which excludes it from the partial index (WHERE is_active = true) AND from
--   listings (WHERE deleted_at IS NULL), freeing the slot for re-use.
-- FK/cascade risk: NONE. `deleted_at` is a scalar column with no FK.
-- Idempotency: `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` make
--   the migration safe to re-apply (e.g. after a partial failure / drift).
-- Approval: additive migration, no destructive ops; follows
--   `vendix-prisma-migrations` mandatory safety rules. Referenced in plan
--   zippy-snuggling-boole.md item #3 (Mejoras módulo Membresías gym).

-- =====================================================================
-- STEP 1: Add nullable `deleted_at` column (soft-archive marker).
--   NULL = not archived (live credential).
--   non-NULL = archived at this timestamp; excluded from listings and from
--   the partial unique index (which already filters by is_active = true).
-- =====================================================================
ALTER TABLE membership_access_credentials ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

-- =====================================================================
-- STEP 2: Partial index on `deleted_at IS NULL` to accelerate the
--   `listCredentials` and `validate` reads, which now filter on this column.
--   Matches the same pattern as `membership_access_cred_active_uq`.
-- =====================================================================
CREATE INDEX IF NOT EXISTS membership_access_cred_deleted_at_idx
  ON membership_access_credentials (deleted_at)
  WHERE deleted_at IS NULL;