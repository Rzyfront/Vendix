-- Migration: split_selected_paid_plan
-- Separates "plan seleccionado" from "plan pagado" in store_subscriptions.
-- Adds paid_plan_id / pending_plan_id fields so plan_id only changes after
-- gateway confirmation. Also adds from_plan / to_plan tracking on invoices.
--
-- DATA IMPACT: schema-only (no row mutations, no deletions, no cascades)
-- Tables modified (DDL only): store_subscriptions, subscription_invoices
-- New type: subscription_change_kind_enum

-- 1. New enum: subscription_change_kind_enum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_change_kind_enum') THEN
    CREATE TYPE "subscription_change_kind_enum" AS ENUM (
      'initial',
      'renewal',
      'upgrade',
      'downgrade',
      'resubscribe',
      'trial_conversion'
    );
  END IF;
END
$$;

-- 2. New columns on store_subscriptions
ALTER TABLE "store_subscriptions" ADD COLUMN IF NOT EXISTS "paid_plan_id"              INTEGER;
ALTER TABLE "store_subscriptions" ADD COLUMN IF NOT EXISTS "pending_plan_id"           INTEGER;
ALTER TABLE "store_subscriptions" ADD COLUMN IF NOT EXISTS "pending_change_invoice_id" INTEGER;
ALTER TABLE "store_subscriptions" ADD COLUMN IF NOT EXISTS "pending_change_kind"       "subscription_change_kind_enum";
ALTER TABLE "store_subscriptions" ADD COLUMN IF NOT EXISTS "pending_change_started_at" TIMESTAMP(3);
ALTER TABLE "store_subscriptions" ADD COLUMN IF NOT EXISTS "pending_revert_state"      "store_subscription_state_enum";

-- 3. FK: store_subscriptions.paid_plan_id -> subscription_plans
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'store_subscriptions_paid_plan_id_fkey'
  ) THEN
    ALTER TABLE "store_subscriptions"
      ADD CONSTRAINT "store_subscriptions_paid_plan_id_fkey"
      FOREIGN KEY ("paid_plan_id") REFERENCES "subscription_plans"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END
$$;

-- 4. FK: store_subscriptions.pending_plan_id -> subscription_plans
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'store_subscriptions_pending_plan_id_fkey'
  ) THEN
    ALTER TABLE "store_subscriptions"
      ADD CONSTRAINT "store_subscriptions_pending_plan_id_fkey"
      FOREIGN KEY ("pending_plan_id") REFERENCES "subscription_plans"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END
$$;

-- 5. FK: store_subscriptions.pending_change_invoice_id -> subscription_invoices
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'store_subscriptions_pending_change_invoice_id_fkey'
  ) THEN
    ALTER TABLE "store_subscriptions"
      ADD CONSTRAINT "store_subscriptions_pending_change_invoice_id_fkey"
      FOREIGN KEY ("pending_change_invoice_id") REFERENCES "subscription_invoices"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END
$$;

-- 6. Indexes on store_subscriptions (new FK columns)
CREATE INDEX IF NOT EXISTS "store_subscriptions_paid_plan_id_idx"    ON "store_subscriptions"("paid_plan_id");
CREATE INDEX IF NOT EXISTS "store_subscriptions_pending_plan_id_idx" ON "store_subscriptions"("pending_plan_id");

-- 7. New columns on subscription_invoices
ALTER TABLE "subscription_invoices" ADD COLUMN IF NOT EXISTS "from_plan_id" INTEGER;
ALTER TABLE "subscription_invoices" ADD COLUMN IF NOT EXISTS "to_plan_id"   INTEGER;
ALTER TABLE "subscription_invoices" ADD COLUMN IF NOT EXISTS "change_kind"  "subscription_change_kind_enum";

-- 8. FK: subscription_invoices.from_plan_id -> subscription_plans
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscription_invoices_from_plan_id_fkey'
  ) THEN
    ALTER TABLE "subscription_invoices"
      ADD CONSTRAINT "subscription_invoices_from_plan_id_fkey"
      FOREIGN KEY ("from_plan_id") REFERENCES "subscription_plans"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END
$$;

-- 9. FK: subscription_invoices.to_plan_id -> subscription_plans
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscription_invoices_to_plan_id_fkey'
  ) THEN
    ALTER TABLE "subscription_invoices"
      ADD CONSTRAINT "subscription_invoices_to_plan_id_fkey"
      FOREIGN KEY ("to_plan_id") REFERENCES "subscription_plans"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END
$$;

-- 10. Indexes on subscription_invoices (new FK columns)
CREATE INDEX IF NOT EXISTS "subscription_invoices_from_plan_id_idx" ON "subscription_invoices"("from_plan_id");
CREATE INDEX IF NOT EXISTS "subscription_invoices_to_plan_id_idx"   ON "subscription_invoices"("to_plan_id");
