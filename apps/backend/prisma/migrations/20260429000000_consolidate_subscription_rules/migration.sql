-- =============================================================================
-- Migration: consolidate_subscription_rules
-- Sprint: S3 — Consolidación del sistema de planes y suscripciones
-- -----------------------------------------------------------------------------
-- DATA IMPACT:
--   Schema-only — no row mutations (ALTER TYPE ADD VALUE, ADD COLUMN, CREATE
--   TABLE, CREATE INDEX). Every DDL is guarded by IF NOT EXISTS.
--
--   Exception: partially_paid removal from invoice enum requires:
--     (a) reassign any existing partially_paid rows to 'issued', then
--     (b) rebuild the enum without that value.
--   This is the ONLY data-mutating step. Guarded by pre-flight check.
--
-- Cascade risk: NO DROP TABLE, NO TRUNCATE, NO CASCADE, NO unscoped DELETE.
--
-- Targeted enum value drops (for partially_paid only):
--   - Pre-flight query counts rows that would be remapped
--   - Uses CREATE TYPE + ALTER COLUMN TYPE + DROP TYPE pattern (safe)
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. store_subscription_state_enum — ADD VALUE 'no_plan'
-- =============================================================================
ALTER TYPE "store_subscription_state_enum"
  ADD VALUE IF NOT EXISTS 'no_plan';

-- =============================================================================
-- 2. subscription_invoice_state_enum — DROP 'partially_paid', ADD 'refunded_chargeback'
--    PG does not support DROP VALUE natively. Pattern:
--      (a) pre-flight: count rows with 'partially_paid'
--      (b) UPDATE those rows to 'issued' (safe: partial payment means
--          invoice is still owed; 'issued' reflects the open amount)
--      (c) CREATE new type without 'partially_paid' + with 'refunded_chargeback'
--      (d) ALTER COLUMN to new type
--      (e) DROP old type
--      (f) RENAME new type to canonical name
-- =============================================================================
DO $$
DECLARE
  v_count INTEGER;
  v_old_oid OID;
BEGIN
  -- Check how many rows would be affected
  SELECT COUNT(*) INTO v_count
  FROM subscription_invoices
  WHERE state = 'partially_paid';

  IF v_count > 0 THEN
    RAISE NOTICE 'Reassigning % partially_paid invoice(s) to ''issued''', v_count;
    UPDATE subscription_invoices
    SET state = 'issued', updated_at = NOW()
    WHERE state = 'partially_paid';
  END IF;

  -- Check if the new type already exists (idempotent re-run)
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typname = 'subscription_invoice_state_enum_v2'
  ) THEN
    -- Drop default on column before altering type
    EXECUTE 'ALTER TABLE "subscription_invoices" ALTER COLUMN "state" DROP DEFAULT';

    -- Create new enum type WITHOUT partially_paid, WITH refunded_chargeback
    CREATE TYPE "subscription_invoice_state_enum_v2" AS ENUM (
      'draft', 'issued', 'paid', 'overdue', 'void', 'refunded', 'refunded_chargeback'
    );

    -- Migrate columns
    ALTER TABLE "subscription_invoices"
      ALTER COLUMN "state" TYPE "subscription_invoice_state_enum_v2"
      USING ("state"::text::"subscription_invoice_state_enum_v2");

    -- Re-add default
    ALTER TABLE "subscription_invoices"
      ALTER COLUMN "state" SET DEFAULT 'draft'::"subscription_invoice_state_enum_v2";

    -- Drop old type
    DROP TYPE "subscription_invoice_state_enum";

    -- Rename new type to canonical name
    ALTER TYPE "subscription_invoice_state_enum_v2"
      RENAME TO "subscription_invoice_state_enum";
  END IF;
END
$$;

-- =============================================================================
-- 3. subscription_event_type_enum — ADD VALUE 'chargeback_received', 'manual_payment'
-- =============================================================================
ALTER TYPE "subscription_event_type_enum"
  ADD VALUE IF NOT EXISTS 'chargeback_received';

ALTER TYPE "subscription_event_type_enum"
  ADD VALUE IF NOT EXISTS 'manual_payment';

-- =============================================================================
-- 4. partner_commission_state_enum — ADD VALUE 'reversed_pending_recovery'
-- =============================================================================
ALTER TYPE "partner_commission_state_enum"
  ADD VALUE IF NOT EXISTS 'reversed_pending_recovery';

-- =============================================================================
-- 5. store_subscriptions — ADD COLUMN lock_reason
-- =============================================================================
ALTER TABLE "store_subscriptions"
  ADD COLUMN IF NOT EXISTS "lock_reason" VARCHAR(64);

COMMENT ON COLUMN "store_subscriptions"."lock_reason" IS
  'Razon del lock cuando state=suspended|blocked. Valores: dunning, admin_manual, fraud, compliance, chargeback, migration';

-- =============================================================================
-- 6. organizations — ADD COLUMNS fraud_blocked, fraud_blocked_at,
--    fraud_blocked_reason, chargeback_count
-- =============================================================================
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "fraud_blocked" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "fraud_blocked_at" TIMESTAMP(6);

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "fraud_blocked_reason" TEXT;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "chargeback_count" INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN "organizations"."fraud_blocked" IS
  'Flag anti-fraude: true cuando la org alcanzo 2 chargebacks. Solo super-admin puede revertir.';
COMMENT ON COLUMN "organizations"."chargeback_count" IS
  'Contador de chargebacks recibidos en toda la historia de la org. Reseteable solo por super-admin.';

-- =============================================================================
-- 7. subscription_plans — PARTIAL UNIQUE INDEX on is_default WHERE is_default=true
--    Ensures only one plan can be default at a time.
-- =============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_plans_is_default_uniq"
  ON "subscription_plans"("is_default")
  WHERE "is_default" = true;

-- =============================================================================
-- 8. CREATE TABLE redemption_consumptions
--    Tracks one-time redemption of promotional plan codes per org.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "redemption_consumptions" (
  "id"                SERIAL       NOT NULL,
  "organization_id"   INTEGER      NOT NULL,
  "plan_id"           INTEGER      NOT NULL,
  "consumed_at"       TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "store_id"          INTEGER,
  "metadata"          JSON,

  CONSTRAINT "redemption_consumptions_pkey"
    PRIMARY KEY ("id"),
  CONSTRAINT "redemption_consumptions_org_plan_uniq"
    UNIQUE ("organization_id", "plan_id"),

  CONSTRAINT "redemption_consumptions_organization_id_fkey"
    FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT "redemption_consumptions_plan_id_fkey"
    FOREIGN KEY ("plan_id")
    REFERENCES "subscription_plans"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "redemption_consumptions_organization_id_idx"
  ON "redemption_consumptions"("organization_id");

CREATE INDEX IF NOT EXISTS "redemption_consumptions_plan_id_idx"
  ON "redemption_consumptions"("plan_id");

COMMENT ON TABLE "redemption_consumptions" IS
  'Audita el consumo de codigos de redencion de planes promocionales. UNIQUE(org, plan) garantiza que una org no re-use el mismo promo.';
COMMENT ON CONSTRAINT "redemption_consumptions_org_plan_uniq" ON "redemption_consumptions" IS
  'Una organizacion no puede aplicar el mismo plan promocional mas de una vez.';

-- =============================================================================
-- 9. CREATE TABLE saas_metrics_snapshot
--    Monthly materialized MRR/ARR + churn snapshots.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "saas_metrics_snapshot" (
  "id"                   SERIAL       NOT NULL,
  "year_month"           VARCHAR(7)   NOT NULL,  -- 'YYYY-MM' format
  "snapshot_at"          TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "mrr"                  DECIMAL(14,2) NOT NULL DEFAULT 0,
  "arr"                  DECIMAL(14,2) NOT NULL DEFAULT 0,
  "active_subscriptions" INTEGER      NOT NULL DEFAULT 0,
  "churn_voluntary"      INTEGER      NOT NULL DEFAULT 0,
  "churn_involuntary"    INTEGER      NOT NULL DEFAULT 0,
  "new_subscriptions"    INTEGER      NOT NULL DEFAULT 0,
  "trial_conversions"    INTEGER      NOT NULL DEFAULT 0,
  "total_revenue"        DECIMAL(14,2) NOT NULL DEFAULT 0,
  "partner_payouts_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "metadata"             JSON,

  CONSTRAINT "saas_metrics_snapshot_pkey"
    PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "saas_metrics_snapshot_year_month_uniq"
  ON "saas_metrics_snapshot"("year_month");

CREATE INDEX IF NOT EXISTS "saas_metrics_snapshot_year_month_idx"
  ON "saas_metrics_snapshot"("year_month");

COMMENT ON TABLE "saas_metrics_snapshot" IS
  'Snapshot mensual materializado de metricas SaaS: MRR, ARR, churn (voluntary vs involuntary), nuevas suscripciones, conversion de trial.';

COMMIT;
