-- DATA IMPACT:
-- Tables affected: lodging_unit_types (schema only). Adds two array columns
-- with an empty-array default; existing rows get [] and keep every other value.
-- Expected row changes: none (no UPDATE/DELETE).
-- Destructive operations: none.
-- FK/cascade risk: none. No constraints added or dropped.
-- Idempotency: ADD COLUMN IF NOT EXISTS.
-- Approval: hospitality plan, slice H0.4 (owner decisions 2026-10-26).

-- Ordered S3 keys of the room type photos (never signed URLs).
ALTER TABLE "lodging_unit_types" ADD COLUMN IF NOT EXISTS "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
-- Amenity codes from the lodging amenities catalog (wifi, air_conditioning...).
ALTER TABLE "lodging_unit_types" ADD COLUMN IF NOT EXISTS "amenities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
