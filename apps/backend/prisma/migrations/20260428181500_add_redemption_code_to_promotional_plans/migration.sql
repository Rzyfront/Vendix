-- ============================================================================
-- Migration: add_redemption_code_to_promotional_plans
-- Sprint: S2 — coupon redemption system
-- ----------------------------------------------------------------------------
-- DATA IMPACT:
--   - Adds nullable column `redemption_code` to subscription_plans (no rows
--     mutated; new column starts NULL on every existing row).
--   - Adds UNIQUE partial index so multiple plans can have NULL but any
--     non-null code must be globally unique (case-insensitive lookups handled
--     at app layer via citext-style normalization).
--   - Adds CHECK constraint enforcing that only plans with
--     plan_type='promotional' OR is_promotional=true may carry a non-null
--     redemption_code. Base/partner_custom plans cannot reuse this column.
--   - Idempotent: safe to re-run via IF NOT EXISTS guards on every DDL.
--   - No DELETE / UPDATE without WHERE; no DROP / TRUNCATE / CASCADE.
-- ============================================================================

-- 1. Add nullable column (idempotent).
ALTER TABLE "subscription_plans"
  ADD COLUMN IF NOT EXISTS "redemption_code" VARCHAR(64);

-- 2. Add UNIQUE constraint (Prisma maps `@unique` to a UNIQUE index over the
--    column; NULLs are allowed multiple times in PostgreSQL by default).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'subscription_plans_redemption_code_key'
  ) THEN
    ALTER TABLE "subscription_plans"
      ADD CONSTRAINT "subscription_plans_redemption_code_key"
      UNIQUE ("redemption_code");
  END IF;
END$$;

-- 3. CHECK constraint: redemption_code MUST be NULL unless the plan is
--    promotional. Validates `plan_type = 'promotional'` OR the legacy boolean
--    `is_promotional = true` (both shapes coexist in the schema).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'subscription_plans_redemption_code_only_promo'
  ) THEN
    ALTER TABLE "subscription_plans"
      ADD CONSTRAINT "subscription_plans_redemption_code_only_promo"
      CHECK (
        "redemption_code" IS NULL
        OR "plan_type" = 'promotional'
        OR "is_promotional" = true
      );
  END IF;
END$$;
