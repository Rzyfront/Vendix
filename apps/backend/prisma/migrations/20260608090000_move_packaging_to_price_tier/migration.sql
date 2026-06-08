-- DATA IMPACT:
--   Tables affected:
--     - price_tiers                       (ADD nullable column: units_per_package)
--     - product_price_tier_overrides      (ADD nullable column: override_units_per_package;
--                                          make override_price NULLABLE)
--     - products                          (DROP columns: units_per_package,
--                                          package_consumes_multiple_stock)
--   Expected row changes:
--     - No UPDATE/DELETE of existing rows. New columns default to NULL so
--       legacy behavior (packSize = 1) is preserved for every existing tier
--       and override.
--   Destructive operations:
--     - DROP COLUMN products.units_per_package
--     - DROP COLUMN products.package_consumes_multiple_stock
--       Both are unused (0 productive rows) and explicitly authorized by the
--       user. Packaging now lives on the price tier.
--   FK/cascade risk: none (no FK, CASCADE, TRUNCATE, or unscoped DELETE/UPDATE).
--   Idempotency: guarded with IF NOT EXISTS / IF EXISTS / DROP NOT NULL
--     (no-op when already applied); safe to re-run.
--   Approval: "Empaque por tarifa" plan — user authorized removing the unused
--     product-level packaging columns (0 productive rows).

BEGIN;

-- 1. price_tiers: packaging quantity now owned by the tier (optional).
ALTER TABLE "price_tiers"
  ADD COLUMN IF NOT EXISTS "units_per_package" INTEGER;

-- 2. product_price_tier_overrides: per-product packaging override (optional)
--    and make the override price nullable (price-only, qty-only, or both).
ALTER TABLE "product_price_tier_overrides"
  ADD COLUMN IF NOT EXISTS "override_units_per_package" INTEGER;

ALTER TABLE "product_price_tier_overrides"
  ALTER COLUMN "override_price" DROP NOT NULL;

-- 3. products: drop the unused product-level packaging columns (authorized).
ALTER TABLE "products"
  DROP COLUMN IF EXISTS "units_per_package";

ALTER TABLE "products"
  DROP COLUMN IF EXISTS "package_consumes_multiple_stock";

COMMIT;
