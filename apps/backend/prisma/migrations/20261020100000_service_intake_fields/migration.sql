-- DATA IMPACT:
-- Tables affected: products.
-- Expected row changes: no existing rows changed; all existing products keep NULL configuration.
-- Destructive operations: none.
-- FK/cascade risk: none.
-- Idempotency: column addition is guarded with IF NOT EXISTS.
-- Approval: user requested configurable fields per service.
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "service_intake_fields" JSONB;
