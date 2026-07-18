-- QUI-473: make role name unique per organization (instead of globally).
--
-- 1. Drop the global UNIQUE constraint on roles.name (was `roles_name_key`).
-- 2. Create a partial UNIQUE index that enforces per-org uniqueness
--    only for non-system, organization-bound roles.
-- 3. Preserve global uniqueness only for global system roles
--    (is_system_role = true AND organization_id IS NULL),
--    so super_admin / owner / admin etc. cannot be duplicated.
-- 4. Recreate the secondary index on organization_id.

-- Step 1: drop the global unique on `name`.
DROP INDEX IF EXISTS "roles_name_key";

-- Step 2: per-org uniqueness for non-system roles.
CREATE UNIQUE INDEX "roles_organization_id_name_key"
  ON "roles"("organization_id", "name")
  WHERE "organization_id" IS NOT NULL;

-- Step 3: global uniqueness only for global system roles.
CREATE UNIQUE INDEX "roles_name_global_system_key"
  ON "roles"("name")
  WHERE "is_system_role" = true AND "organization_id" IS NULL;

-- Step 4: secondary index (idempotent — only creates if missing).
CREATE INDEX IF NOT EXISTS "roles_organization_id_idx" ON "roles"("organization_id");
