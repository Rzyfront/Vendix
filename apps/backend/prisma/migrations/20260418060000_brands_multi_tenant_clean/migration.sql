-- Brands become store-scoped (multi-tenant).
-- PR #237 introduced schema changes on the `brands` model without shipping
-- a migration, leaving prod schema drifted from the Prisma client.
--
-- Business decision: all stores start with a clean brands list. Existing
-- global brands are wiped; products remain but are disassociated (brand_id
-- is nullable).
--
-- SAFETY: Previous version used `TRUNCATE brands RESTART IDENTITY CASCADE`,
-- which silently wiped products, variants, and order_items because TRUNCATE
-- CASCADE operates at the table level and ignores ON DELETE rules. This
-- patched version drops the FK from products BEFORE clearing brands so no
-- cascade can propagate. All statements are idempotent.
--
-- Pre-deploy notes:
--   * Snapshot DB before apply.
--   * Apply this migration BEFORE restarting the backend with the new
--     Prisma client (schema.prisma already updated on main).
--   * After apply, stores will have 0 brands; UI must tolerate empty lists.
--   * Products, variants, and order_items are PRESERVED.

BEGIN;

-- 1. Drop FK products -> brands FIRST so no cascade can propagate
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_brand_id_fkey;

-- 2. Disassociate products from any existing brand (brand_id is Int?)
UPDATE products SET brand_id = NULL WHERE brand_id IS NOT NULL;

-- 3. Clear brands WITHOUT CASCADE - FK already dropped, so no dependent table is touched
DELETE FROM brands;

-- 4. Reset identity sequence (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'brands_id_seq') THEN
    PERFORM setval('brands_id_seq', 1, false);
  END IF;
END $$;

-- 5. Drop the legacy global unique on name
ALTER TABLE brands DROP CONSTRAINT IF EXISTS brands_name_key;

-- 6. Add multi-tenant columns (safe: table is empty after DELETE)
ALTER TABLE brands ADD COLUMN IF NOT EXISTS store_id INT NOT NULL;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS slug VARCHAR(120) NOT NULL;

-- 7. FK brands.store_id -> stores (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brands_store_id_fkey') THEN
    ALTER TABLE brands
      ADD CONSTRAINT brands_store_id_fkey
      FOREIGN KEY (store_id) REFERENCES stores(id)
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- 8. Index + compound uniques matching schema.prisma (idempotent)
CREATE INDEX IF NOT EXISTS brands_store_id_idx ON brands(store_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brands_store_id_name_key') THEN
    ALTER TABLE brands ADD CONSTRAINT brands_store_id_name_key UNIQUE (store_id, name);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brands_store_id_slug_key') THEN
    ALTER TABLE brands ADD CONSTRAINT brands_store_id_slug_key UNIQUE (store_id, slug);
  END IF;
END $$;

-- 9. Recreate FK products -> brands matching schema.prisma (Restrict, NO ACTION)
-- Safe even under RESTRICT because:
--   a) products.brand_id has been set to NULL in step 2 (nothing references brands)
--   b) brands is empty after step 3
-- So no future DELETE FROM brands will violate RESTRICT in this migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_brand_id_fkey') THEN
    ALTER TABLE products
      ADD CONSTRAINT products_brand_id_fkey
      FOREIGN KEY (brand_id) REFERENCES brands(id)
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

COMMIT;
