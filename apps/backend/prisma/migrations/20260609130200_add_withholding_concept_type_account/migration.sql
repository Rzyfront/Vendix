-- DATA IMPACT:
-- Tables affected: withholding_concepts
-- Expected row changes: existing rows backfill withholding_type='retefuente' via column DEFAULT; account_code left NULL
-- Destructive operations: none (additive ADD COLUMN IF NOT EXISTS only)
-- FK/cascade risk: none
-- Idempotency: ADD COLUMN IF NOT EXISTS
-- Approval: documented in docs/plans/withholding-system.plan.md (Block A)
-- Note: uses withholding_type_enum created in migration 20260609130000

ALTER TABLE "withholding_concepts"
  ADD COLUMN IF NOT EXISTS "withholding_type" "withholding_type_enum" NOT NULL DEFAULT 'retefuente';

ALTER TABLE "withholding_concepts"
  ADD COLUMN IF NOT EXISTS "account_code" VARCHAR(20);
