-- DATA IMPACT:
-- Tables affected: suppliers, users
-- Expected row changes: existing rows backfill is_self_withholder=false / is_withholding_agent=false via column DEFAULT;
--   person_type / tax_regime left NULL
-- Destructive operations: none (additive ADD COLUMN IF NOT EXISTS only)
-- FK/cascade risk: none
-- Idempotency: ADD COLUMN IF NOT EXISTS
-- Approval: documented in docs/plans/withholding-system.plan.md (Block A)

-- suppliers: fiscal classification for retenedor/retenido decisioning
ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "person_type" VARCHAR(20);

ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "is_self_withholder" BOOLEAN NOT NULL DEFAULT false;

-- users: fiscal classification for counterparty decisioning (customers as counterparties)
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "tax_regime" VARCHAR(50);

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "person_type" VARCHAR(20);

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_withholding_agent" BOOLEAN NOT NULL DEFAULT false;
