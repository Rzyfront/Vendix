-- DATA IMPACT:
-- Tables affected: data_collection_templates (1 new nullable column).
-- Expected row changes: none. Existing templates keep NULL (general template).
-- Destructive operations: none.
-- FK/cascade risk: none.
-- Idempotency: guarded with IF NOT EXISTS.
ALTER TABLE "data_collection_templates" ADD COLUMN IF NOT EXISTS "station_type" VARCHAR(32);
