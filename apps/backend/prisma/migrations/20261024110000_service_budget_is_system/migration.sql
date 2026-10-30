-- DATA IMPACT:
-- Tables affected: service_budgets (1 new column, default false).
-- Expected row changes: none rewritten. Existing budgets stay is_system=false (treated as
--   merchant/customer caps, as before).
-- Destructive operations: none.
-- FK/cascade risk: none.
-- Idempotency: guarded with IF NOT EXISTS.
ALTER TABLE "service_budgets" ADD COLUMN IF NOT EXISTS "is_system" BOOLEAN NOT NULL DEFAULT false;
