-- Brands become store-scoped (multi-tenant).
-- PR #237 introduced schema changes on the `brands` model without shipping
-- a migration, leaving prod schema drifted from the Prisma client.
--
-- Business decision: all stores start with a clean brands list. Existing
-- global brands are wiped and products are disassociated (products.brand_id
-- is nullable, so no FK violation).
--
-- Pre-deploy notes:
--   * Snapshot DB before apply.
--   * Apply this migration BEFORE restarting the backend with the new
--     Prisma client (schema.prisma already updated on main).
--   * After apply, stores will have 0 brands; UI must tolerate empty lists.

BEGIN;

-- 1. Disassociate products from any existing brand (brand_id is Int?)
UPDATE products SET brand_id = NULL WHERE brand_id IS NOT NULL;

-- 2. Wipe brands and reset identity
TRUNCATE TABLE brands RESTART IDENTITY CASCADE;

-- 3. Drop the legacy global unique on name
ALTER TABLE brands DROP CONSTRAINT IF EXISTS brands_name_key;

-- 4. Add multi-tenant columns (safe: table is empty after TRUNCATE)
ALTER TABLE brands ADD COLUMN IF NOT EXISTS store_id INT NOT NULL;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS slug VARCHAR(120) NOT NULL;

-- 5. FK to stores with cascade on delete
ALTER TABLE brands
  ADD CONSTRAINT brands_store_id_fkey
  FOREIGN KEY (store_id) REFERENCES stores(id)
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- 6. Index and compound uniques matching schema.prisma
CREATE INDEX IF NOT EXISTS brands_store_id_idx ON brands(store_id);

ALTER TABLE brands
  ADD CONSTRAINT brands_store_id_name_key UNIQUE (store_id, name);

ALTER TABLE brands
  ADD CONSTRAINT brands_store_id_slug_key UNIQUE (store_id, slug);

COMMIT;
