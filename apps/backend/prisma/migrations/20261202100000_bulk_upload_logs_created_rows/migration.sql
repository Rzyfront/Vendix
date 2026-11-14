-- DATA IMPACT: none (schema only, additive)
-- Tables affected: bulk_upload_logs (one NEW nullable column)
-- Expected row changes: 0 (existing rows keep NULL = upload type does not report created rows)
-- Destructive operations: none (no DROP, TRUNCATE, DELETE or UPDATE)
-- FK/cascade risk: none
-- Idempotency: ADD COLUMN IF NOT EXISTS
-- Purpose: QUI-1004 rows that created a product (purchase bulk upload creates missing products)

ALTER TABLE "bulk_upload_logs" ADD COLUMN IF NOT EXISTS "created_rows" INTEGER;
