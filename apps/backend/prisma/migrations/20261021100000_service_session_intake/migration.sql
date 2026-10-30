-- DATA IMPACT:
-- Tables affected: entity_type_enum (new value).
-- Expected row changes: none. entity_metadata_values rows are untouched; the new enum value
--   'service_session' lets per-attention intake answers be stored against service_sessions.id.
-- Destructive operations: none (the former DROP COLUMN of the unmerged products.service_intake_fields
--   was removed with its pair migration 20261020100000; the column never shipped).
-- FK/cascade risk: none.
-- Idempotency: guarded with IF NOT EXISTS.
ALTER TYPE "entity_type_enum" ADD VALUE IF NOT EXISTS 'service_session';
