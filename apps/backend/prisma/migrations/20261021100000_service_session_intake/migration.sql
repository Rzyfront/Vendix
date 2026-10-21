-- DATA IMPACT:
-- Tables affected: products (column drop), entity_type_enum (new value).
-- Expected row changes: none. entity_metadata_values rows are untouched; the new enum value
--   'service_session' lets per-attention intake answers be stored against service_sessions.id.
-- Destructive operations: DROP COLUMN products.service_intake_fields. The column was only
--   introduced by the local migration 20261020100000_service_intake_fields (never deployed,
--   no production data). Per-service intake fields are now modeled with data_collection_templates.
-- FK/cascade risk: none.
-- Idempotency: guarded with IF NOT EXISTS / IF EXISTS.
-- Approval: user explicitly approved dropping the column (replaced by Recolección de datos).
ALTER TYPE "entity_type_enum" ADD VALUE IF NOT EXISTS 'service_session';

ALTER TABLE "products" DROP COLUMN IF EXISTS "service_intake_fields";
