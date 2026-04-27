-- =====================================================================
-- Migration: subscription_check_constraints
-- Purpose: Add CHECK constraints to subscription_plans to enforce
--          domain invariants at the database level.
-- =====================================================================
--
-- DATA IMPACT:
--   Tables affected: subscription_plans (constraint definitions only)
--   Rows mutated:    NONE (this migration is purely DDL — no INSERT/UPDATE/DELETE)
--   FK changes:      NONE
--
-- CONSTRAINTS ADDED (all idempotent via ADD CONSTRAINT IF NOT EXISTS pattern):
--   1. subscription_plans_base_price_nonneg
--        -> base_price >= 0
--   2. subscription_plans_grace_window_order
--        -> grace_period_soft_days >= 0
--           AND grace_period_hard_days >= grace_period_soft_days
--           AND suspension_day       >= grace_period_hard_days
--           AND cancellation_day     >= suspension_day
--   3. subscription_plans_trial_days_nonneg
--        -> trial_days >= 0
--
-- PRE-FLIGHT GUARD:
--   Before attempting to add the constraints, this migration counts rows that
--   would violate them. If ANY violation is found, the migration ABORTS via
--   RAISE EXCEPTION so the operator can clean the data manually. This avoids
--   PostgreSQL emitting a generic "check constraint is violated by some row"
--   error that would leave the migration partially applied / blocked.
--
-- IDEMPOTENCY:
--   Each ALTER TABLE ... ADD CONSTRAINT is wrapped in DO $$ ... EXCEPTION
--   WHEN duplicate_object THEN NULL; END $$; so re-running the migration is
--   safe and produces no error.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PRE-FLIGHT VALIDATION — abort if any existing row violates a rule.
-- ---------------------------------------------------------------------
DO $preflight$
DECLARE
  v_bad_base_price   bigint;
  v_bad_grace_window bigint;
  v_bad_trial_days   bigint;
BEGIN
  -- Skip pre-flight if the table doesn't exist yet (fresh DB before earlier
  -- migrations have created it). The constraint additions below are also
  -- guarded by IF EXISTS so a fresh DB will simply no-op gracefully.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'subscription_plans'
  ) THEN
    RAISE NOTICE 'subscription_plans table does not exist yet — skipping pre-flight.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_bad_base_price
  FROM subscription_plans
  WHERE base_price < 0;

  SELECT count(*) INTO v_bad_grace_window
  FROM subscription_plans
  WHERE grace_period_soft_days < 0
     OR grace_period_hard_days < grace_period_soft_days
     OR suspension_day         < grace_period_hard_days
     OR cancellation_day       < suspension_day;

  SELECT count(*) INTO v_bad_trial_days
  FROM subscription_plans
  WHERE trial_days < 0;

  IF v_bad_base_price > 0
     OR v_bad_grace_window > 0
     OR v_bad_trial_days > 0
  THEN
    RAISE EXCEPTION
      'subscription_plans CHECK preflight FAILED — '
      'rows violating base_price>=0: %, '
      'rows violating grace-window ordering: %, '
      'rows violating trial_days>=0: %. '
      'Clean these rows manually before re-running this migration.',
      v_bad_base_price, v_bad_grace_window, v_bad_trial_days
    USING ERRCODE = 'check_violation';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------
-- 2. CHECK constraint: base_price >= 0
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'subscription_plans'
  ) THEN
    BEGIN
      ALTER TABLE "subscription_plans"
        ADD CONSTRAINT "subscription_plans_base_price_nonneg"
        CHECK ("base_price" >= 0);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- 3. CHECK constraint: grace-window ordering
--    soft >= 0, hard >= soft, suspension >= hard, cancellation >= suspension
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'subscription_plans'
  ) THEN
    BEGIN
      ALTER TABLE "subscription_plans"
        ADD CONSTRAINT "subscription_plans_grace_window_order"
        CHECK (
              "grace_period_soft_days" >= 0
          AND "grace_period_hard_days" >= "grace_period_soft_days"
          AND "suspension_day"         >= "grace_period_hard_days"
          AND "cancellation_day"       >= "suspension_day"
        );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- 4. CHECK constraint: trial_days >= 0
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'subscription_plans'
  ) THEN
    BEGIN
      ALTER TABLE "subscription_plans"
        ADD CONSTRAINT "subscription_plans_trial_days_nonneg"
        CHECK ("trial_days" >= 0);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END
$$;
