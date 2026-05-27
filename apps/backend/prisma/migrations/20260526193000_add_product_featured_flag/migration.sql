-- DATA IMPACT:
-- Tables affected: products
-- Expected row changes: none
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: guarded ADD COLUMN and CREATE INDEX for concurrent dev safety.

ALTER TABLE "products"
ADD COLUMN IF NOT EXISTS "is_featured" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "products_store_id_is_featured_idx"
ON "products"("store_id", "is_featured");
