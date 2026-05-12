-- =============================================================================
-- Migration: add_scheduled_plan_change
-- Sprint: S3 — Subscriptions consolidation (RNC-16 / RNC-17)
-- -----------------------------------------------------------------------------
-- DATA IMPACT:
--   Schema-only — no row mutations.
--   Adds two nullable columns and one partial index to store_subscriptions
--   to support end-of-period plan changes (downgrade scheduled at period_end).
--
--     scheduled_plan_change_at  TIMESTAMPTZ  NULL
--     scheduled_plan_id         INT          NULL  -> subscription_plans(id)
--                                                    ON DELETE SET NULL
--
--   Index is partial (only rows with a pending scheduled change) to keep it
--   small for the renewal cron's "due-now" sweep.
--
-- Cascade risk: NONE. Adding nullable columns and a partial index is fully
-- non-destructive. ON DELETE SET NULL keeps store_subscriptions rows intact
-- if a referenced subscription_plans row is hard-deleted (which itself is
-- gated upstream).
--
-- Idempotent: every DDL guarded by IF NOT EXISTS.
-- =============================================================================

BEGIN;

-- 1. scheduled_plan_change_at — when to apply the deferred plan change.
ALTER TABLE "store_subscriptions"
  ADD COLUMN IF NOT EXISTS "scheduled_plan_change_at" TIMESTAMPTZ NULL;

-- 2. scheduled_plan_id — target plan to switch to at scheduled_plan_change_at.
ALTER TABLE "store_subscriptions"
  ADD COLUMN IF NOT EXISTS "scheduled_plan_id" INT NULL;

-- 3. FK to subscription_plans, ON DELETE SET NULL so a hard-deleted plan
--    does not cascade-delete the subscription row. Constraint name is
--    explicit so re-runs detect existence cleanly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'store_subscriptions_scheduled_plan_id_fkey'
  ) THEN
    ALTER TABLE "store_subscriptions"
      ADD CONSTRAINT "store_subscriptions_scheduled_plan_id_fkey"
      FOREIGN KEY ("scheduled_plan_id")
      REFERENCES "subscription_plans"("id")
      ON DELETE SET NULL
      ON UPDATE NO ACTION;
  END IF;
END
$$;

-- 4. Partial index for the renewal-cron sweep ("due-now" downgrades only).
--    Keeps the index narrow because most subscriptions have NULL here.
CREATE INDEX IF NOT EXISTS "idx_store_subscriptions_scheduled_plan_change_at"
  ON "store_subscriptions" ("scheduled_plan_change_at")
  WHERE "scheduled_plan_change_at" IS NOT NULL;

COMMIT;
