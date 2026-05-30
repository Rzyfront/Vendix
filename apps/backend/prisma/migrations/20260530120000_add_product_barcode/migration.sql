-- DATA IMPACT: adds nullable products.barcode and product_variants.barcode columns + indexes; 0 rows mutated; no data destroyed
-- Tables affected: products, product_variants
-- Expected row changes: none (only ADD COLUMN + CREATE INDEX/UNIQUE INDEX)
-- Destructive operations: none (no DROP/TRUNCATE/CASCADE, no unscoped DELETE/UPDATE)
-- FK/cascade risk: none (no FKs added or dropped)
-- Idempotency: guarded with IF NOT EXISTS on every statement
-- Approval: additive barcode field for HID barcode-scanner feature (feat/subscription-plan-multi-cycle)
--
-- Uniqueness note: products gets a COMPOSITE UNIQUE (store_id, barcode). In
-- PostgreSQL a multi-column UNIQUE treats NULL as distinct, so multiple rows
-- with barcode IS NULL are allowed per store; uniqueness is only enforced when
-- a barcode is actually set. No partial WHERE clause is required.
-- product_variants has no store_id (scoped relationally via products.store_id),
-- so it gets only a lookup index; store-level uniqueness is enforced in the app.

-- 1. Add nullable barcode to products.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "barcode" VARCHAR(64);

-- 2. Add nullable barcode to product_variants.
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "barcode" VARCHAR(64);

-- 3. Store-scoped uniqueness for products (NULLs allowed multiple times per store).
CREATE UNIQUE INDEX IF NOT EXISTS "products_store_id_barcode_key" ON "products"("store_id", "barcode");

-- 4. Lookup index for products by store + barcode (scan resolution).
CREATE INDEX IF NOT EXISTS "products_store_id_barcode_idx" ON "products"("store_id", "barcode");

-- 5. Lookup index for variant barcode scans (store scope applied via products.store_id at app layer).
CREATE INDEX IF NOT EXISTS "product_variants_barcode_idx" ON "product_variants"("barcode");
