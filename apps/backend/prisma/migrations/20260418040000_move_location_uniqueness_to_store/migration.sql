-- Move inventory_locations uniqueness from (organization_id, code) to (store_id, code).
-- Stores operate independently; the organization is an informational boundary,
-- not an operational one. Each store must be able to use standard codes like
-- BOD-001 / BOD-002 regardless of sister stores within the same org.
--
-- Pre-deploy verification (run in prod): confirmed
--   * 0 rows with store_id IS NULL
--   * 0 rows with duplicate (store_id, code)
--   * 61 total rows
-- so the new unique index will not be violated by existing data.

-- 1. Drop the old org-level unique index
DROP INDEX IF EXISTS "inventory_locations_organization_id_code_key";

-- 2. Create the new store-level unique index
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_locations_store_id_code_key"
  ON "inventory_locations" USING btree (store_id, code);
