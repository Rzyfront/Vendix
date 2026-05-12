-- =====================================================================
-- Auto-Trial Strategy — schema only
-- =====================================================================
-- DATA IMPACT:
--   Tables affected:
--     * organizations:
--         ADD COLUMN has_consumed_trial BOOLEAN NOT NULL DEFAULT false (idempotent)
--         ADD COLUMN trial_consumed_at  TIMESTAMP(6) NULL              (idempotent)
--     * subscription_plans:
--         ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false (idempotent)
--         CREATE UNIQUE INDEX subscription_plans_unique_default_active
--           (partial: WHERE is_default=true AND state='active' AND archived_at IS NULL)
--   Tables preserved: all others.
--   No backfill UPDATEs — the legacy seed migration that depended on
--   trial-full was removed before first deploy. The default plan is
--   provisioned by prisma/seeds/subscription-plans.seed.ts.
-- =====================================================================

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "has_consumed_trial" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "trial_consumed_at" TIMESTAMP(6);

ALTER TABLE "subscription_plans"
  ADD COLUMN IF NOT EXISTS "is_default" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_plans_unique_default_active"
  ON "subscription_plans" ("is_default")
  WHERE "is_default" = true
    AND "state" = 'active'
    AND "archived_at" IS NULL;
