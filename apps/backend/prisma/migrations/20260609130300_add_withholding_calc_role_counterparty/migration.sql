-- DATA IMPACT:
-- Tables affected: withholding_calculations
-- Expected row changes: existing rows backfill role='practiced' via column DEFAULT;
--   counterparty_type / customer_id / withholding_type left NULL
-- Destructive operations: none (additive ADD COLUMN IF NOT EXISTS + DROP NOT NULL on already-nullable col)
-- FK/cascade risk: new FK customer_id -> users(id) ON DELETE SET NULL (non-destructive, nulls the ref)
-- Idempotency: ADD COLUMN IF NOT EXISTS; FK guarded by pg_constraint existence check; ALTER DROP NOT NULL is safe if already nullable
-- Approval: documented in docs/plans/withholding-system.plan.md (Block A)
-- Note: uses withholding_type_enum (20260609130000) and withholding_role_enum (20260609130100); users.id is INTEGER

ALTER TABLE "withholding_calculations"
  ADD COLUMN IF NOT EXISTS "role" "withholding_role_enum" NOT NULL DEFAULT 'practiced';

ALTER TABLE "withholding_calculations"
  ADD COLUMN IF NOT EXISTS "counterparty_type" VARCHAR(20);

ALTER TABLE "withholding_calculations"
  ADD COLUMN IF NOT EXISTS "customer_id" INTEGER;

ALTER TABLE "withholding_calculations"
  ADD COLUMN IF NOT EXISTS "withholding_type" "withholding_type_enum";

-- supplier_id is already nullable in the model; statement is safe (no-op) if already nullable
ALTER TABLE "withholding_calculations"
  ALTER COLUMN "supplier_id" DROP NOT NULL;

-- Supporting index for customer-scoped lookups (matches schema @@index)
CREATE INDEX IF NOT EXISTS "withholding_calculations_organization_id_customer_id_year_idx"
  ON "withholding_calculations" ("organization_id", "customer_id", "year");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'withholding_calculations_customer_id_fkey'
  ) THEN
    ALTER TABLE "withholding_calculations"
      ADD CONSTRAINT "withholding_calculations_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
