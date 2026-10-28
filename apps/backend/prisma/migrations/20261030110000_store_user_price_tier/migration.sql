-- DATA IMPACT:
-- Tables affected: store_users gains price_tier_id (nullable) with an FK to
--   price_tiers ON DELETE SET NULL and an index.
-- Expected row changes: none. Every existing membership keeps NULL (no tier).
-- Destructive operations: none.
-- FK/cascade risk: SET NULL only; deleting a tier clears the customer's tier,
--   never the store membership. No CASCADE.
-- Idempotency: ADD COLUMN IF NOT EXISTS, guarded constraint, CREATE INDEX IF NOT EXISTS.
-- Approval: odd/tasks/price-tier-adjustments-customers.md (S5).

ALTER TABLE "store_users" ADD COLUMN IF NOT EXISTS "price_tier_id" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'store_users_price_tier_id_fkey'
  ) THEN
    ALTER TABLE "store_users"
      ADD CONSTRAINT "store_users_price_tier_id_fkey"
      FOREIGN KEY ("price_tier_id") REFERENCES "price_tiers"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "store_users_price_tier_id_idx" ON "store_users"("price_tier_id");
