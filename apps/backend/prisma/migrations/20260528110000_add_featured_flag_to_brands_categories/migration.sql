-- DATA IMPACT:
-- Tables affected: brands, categories
-- Expected row changes: none (schema-only addition; existing rows default to false)
-- Destructive operations: none
-- FK/cascade risk: none (columns have no FK)
-- Idempotency: ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS guards re-execution
-- Approval: user requested featured brands/categories for ecommerce home priority
--
-- Adds featured flags for store brands and categories so ecommerce home
-- sections can prioritize highlighted records before the regular catalog list.

ALTER TABLE "brands"
ADD COLUMN IF NOT EXISTS "is_featured" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "categories"
ADD COLUMN IF NOT EXISTS "is_featured" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "brands_store_id_is_featured_idx"
ON "brands"("store_id", "is_featured");

CREATE INDEX IF NOT EXISTS "categories_store_id_is_featured_idx"
ON "categories"("store_id", "is_featured");
