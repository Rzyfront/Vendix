-- ============================================================================
-- Verify the `roles_organization_id_name_key` index uses NULLS NOT DISTINCT
-- ============================================================================
--
-- Background (QUI-473):
-- The composite unique on (organization_id, name) replaces the legacy global
-- @@unique on roles.name. PostgreSQL's default is `NULLS DISTINCT`, which
-- means `(NULL, 'carrier')` and `(NULL, 'carrier')` would NOT collide, allowing
-- duplicate system-role names. The fix is `NULLS NOT DISTINCT` (PG 15+),
-- which makes NULL compare equal so the rows DO collide.
--
-- Prisma cannot express `NULLS NOT DISTINCT` in `@@unique(...)`, so this
-- invariant is set by hand in `20260725000000_roles_nulls_not_distinct/migration.sql`.
-- Any future schema regeneration that drops that migration will silently
-- recreate the index WITHOUT the modifier, re-opening the original hole.
--
-- Run this script after every `prisma migrate dev` / `prisma db push` /
-- migration-regeneration cycle to confirm the production database still has
-- the modifier in place.
--
-- Expected: `indnullsnotdistinct = true`
-- If false: re-apply `20260725000000_roles_nulls_not_distinct/migration.sql`
-- manually against the affected environment.
-- ============================================================================

SELECT
  indexrelid::regclass   AS index_name,
  indrelid::regclass     AS table_name,
  indkey::int2vector     AS key_columns,
  indisunique            AS is_unique,
  indnullsnotdistinct    AS nulls_not_distinct
FROM pg_index
WHERE indexrelid = '"roles_organization_id_name_key"'::regclass;