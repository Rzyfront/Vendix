-- DATA IMPACT:
--   Tables affected: store_subscriptions
--     - Schema: ALTER COLUMN plan_id DROP NOT NULL (no row data lost)
--     - Data: UPDATE plan_id = NULL WHERE state = 'no_plan' AND plan_id IS NOT NULL
--             (clears placeholder plan ids from rows that should have no plan per RNC-39)
--   Expected row changes: small (additional stores in orgs without trial available)
--   Tables preserved: subscription_plans, partner_plan_overrides, subscription_invoices
--   FK strategy: existing FK store_subscriptions_plan_id_fkey already supports NULL
--                (Postgres FKs allow NULL by default; only NOT NULL constraint blocked it)
--   Cascade risk: NONE — no inbound FKs depend on plan_id at this level
--   Rationale (RNC-39): stores additional in orgs without trial available start in 'no_plan'
--                       and must NOT have any plan_id leaked into reads (hero card, billing, etc.)
--   Idempotent: yes — DROP NOT NULL is no-op if already nullable; UPDATE only touches no_plan rows.

-- 1. Make plan_id nullable
ALTER TABLE "store_subscriptions" ALTER COLUMN "plan_id" DROP NOT NULL;

-- 2. Clear placeholder plan_id on rows that should have no plan (RNC-39)
UPDATE "store_subscriptions"
SET "plan_id" = NULL
WHERE "state" = 'no_plan'
  AND "plan_id" IS NOT NULL;
