-- =====================================================================
-- SaaS Subscriptions Module — Phase A: Schema init
-- =====================================================================
-- DATA IMPACT:
--   Tables affected: SCHEMA-ONLY additions (no row mutations).
--     * New tables (IF NOT EXISTS): subscription_plans, partner_plan_overrides,
--       store_subscriptions, subscription_invoices, subscription_payments,
--       partner_commissions, partner_payout_batches, subscription_events,
--       platform_settings.
--     * New enums (idempotent via DO $$ ... END $$): subscription_plan_type_enum,
--       subscription_plan_state_enum, subscription_billing_cycle_enum,
--       store_subscription_state_enum, subscription_invoice_state_enum,
--       subscription_payment_state_enum, subscription_event_type_enum,
--       partner_commission_state_enum, notification_severity_enum.
--     * Added labels to notification_type_enum (IF NOT EXISTS):
--       subscription_payment_reminder_soft, subscription_payment_reminder_hard,
--       subscription_suspended, subscription_blocked, subscription_reactivated,
--       subscription_promo_applied, subscription_renewal_upcoming,
--       partner_commission_available.
--     * Column additions (IF NOT EXISTS):
--         organizations: is_partner, partner_settings, partner_since
--         notifications: severity
--         ai_engine_applications: ai_feature_category
--   Expected row changes: ZERO. This migration mutates no existing data.
--   FK policy: all new FKs use ON DELETE RESTRICT or SET NULL (no CASCADE to
--   parent tables, per global data-safety rule §6).
--   Idempotency: all CREATEs / ALTER ADD COLUMN guarded with IF NOT EXISTS
--   or DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. New enums (idempotent)
-- ---------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "subscription_plan_type_enum" AS ENUM ('base', 'partner_custom', 'promotional');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "subscription_plan_state_enum" AS ENUM ('draft', 'active', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "subscription_billing_cycle_enum" AS ENUM ('monthly', 'quarterly', 'semiannual', 'annual', 'lifetime');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "store_subscription_state_enum" AS ENUM (
    'draft', 'trial', 'active', 'grace_soft', 'grace_hard',
    'suspended', 'blocked', 'cancelled', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "subscription_invoice_state_enum" AS ENUM (
    'draft', 'issued', 'paid', 'partially_paid', 'overdue', 'void', 'refunded'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "subscription_payment_state_enum" AS ENUM (
    'pending', 'succeeded', 'failed', 'refunded', 'partial_refund'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "subscription_event_type_enum" AS ENUM (
    'created', 'activated', 'renewed', 'trial_started', 'trial_ended',
    'payment_succeeded', 'payment_failed', 'state_transition', 'plan_changed',
    'cancelled', 'reactivated', 'promotional_applied',
    'partner_override_applied', 'partner_commission_accrued',
    'partner_commission_paid'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "partner_commission_state_enum" AS ENUM ('accrued', 'pending_payout', 'paid', 'reversed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "notification_severity_enum" AS ENUM ('info', 'warning', 'critical', 'blocker');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------------------------------------------------------------------
-- 2. Extend notification_type_enum (idempotent ADD VALUE)
-- ---------------------------------------------------------------------

ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'subscription_payment_reminder_soft';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'subscription_payment_reminder_hard';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'subscription_suspended';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'subscription_blocked';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'subscription_reactivated';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'subscription_promo_applied';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'subscription_renewal_upcoming';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'partner_commission_available';

-- ---------------------------------------------------------------------
-- 3. Extend existing tables (additive only, IF NOT EXISTS)
-- ---------------------------------------------------------------------

-- organizations: partner program fields
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "is_partner" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "partner_settings" JSONB;
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "partner_since" TIMESTAMP(6);

CREATE INDEX IF NOT EXISTS "organizations_is_partner_idx"
  ON "organizations" ("is_partner");

-- notifications: severity
ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "severity" "notification_severity_enum" NOT NULL DEFAULT 'info';

CREATE INDEX IF NOT EXISTS "notifications_store_id_severity_is_read_idx"
  ON "notifications" ("store_id", "severity", "is_read");

-- ai_engine_applications: ai_feature_category
ALTER TABLE "ai_engine_applications"
  ADD COLUMN IF NOT EXISTS "ai_feature_category" VARCHAR(32);

CREATE INDEX IF NOT EXISTS "ai_engine_applications_ai_feature_category_idx"
  ON "ai_engine_applications" ("ai_feature_category");

-- ---------------------------------------------------------------------
-- 4. New tables (IF NOT EXISTS)
-- ---------------------------------------------------------------------

-- 4.1 subscription_plans ------------------------------------------------
CREATE TABLE IF NOT EXISTS "subscription_plans" (
  "id"                     SERIAL                               PRIMARY KEY,
  "code"                   VARCHAR(64)                          NOT NULL,
  "name"                   VARCHAR(128)                         NOT NULL,
  "description"            TEXT,
  "plan_type"              "subscription_plan_type_enum"        NOT NULL DEFAULT 'base',
  "state"                  "subscription_plan_state_enum"       NOT NULL DEFAULT 'draft',
  "billing_cycle"          "subscription_billing_cycle_enum"    NOT NULL DEFAULT 'monthly',
  "base_price"             DECIMAL(12,2)                        NOT NULL,
  "currency"               VARCHAR(3)                           NOT NULL DEFAULT 'COP',
  "setup_fee"              DECIMAL(12,2),
  "trial_days"             INTEGER                              NOT NULL DEFAULT 0,
  "grace_period_soft_days" INTEGER                              NOT NULL DEFAULT 5,
  "grace_period_hard_days" INTEGER                              NOT NULL DEFAULT 10,
  "suspension_day"         INTEGER                              NOT NULL DEFAULT 14,
  "cancellation_day"       INTEGER                              NOT NULL DEFAULT 45,
  "feature_matrix"         JSONB                                NOT NULL,
  "ai_feature_flags"       JSONB                                NOT NULL,
  "resellable"             BOOLEAN                              NOT NULL DEFAULT false,
  "max_partner_margin_pct" DECIMAL(5,2),
  "is_promotional"         BOOLEAN                              NOT NULL DEFAULT false,
  "promo_rules"            JSONB,
  "promo_priority"         INTEGER                              NOT NULL DEFAULT 0,
  "parent_plan_id"         INTEGER,
  "created_at"             TIMESTAMP(6)                         NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMP(6)                         NOT NULL DEFAULT now(),
  "created_by"             INTEGER,
  "archived_at"            TIMESTAMP(6)
);

-- Unique + indexes
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_plans_code_key"
  ON "subscription_plans" ("code");
CREATE INDEX IF NOT EXISTS "subscription_plans_plan_type_state_idx"
  ON "subscription_plans" ("plan_type", "state");
CREATE INDEX IF NOT EXISTS "subscription_plans_is_promotional_promo_priority_idx"
  ON "subscription_plans" ("is_promotional", "promo_priority");

-- Self-FK (lineage). ON DELETE SET NULL (safe: child survives parent removal).
DO $$ BEGIN
  ALTER TABLE "subscription_plans"
    ADD CONSTRAINT "subscription_plans_parent_plan_id_fkey"
    FOREIGN KEY ("parent_plan_id") REFERENCES "subscription_plans"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.2 partner_plan_overrides -------------------------------------------
CREATE TABLE IF NOT EXISTS "partner_plan_overrides" (
  "id"                 SERIAL         PRIMARY KEY,
  "organization_id"    INTEGER        NOT NULL,
  "base_plan_id"       INTEGER        NOT NULL,
  "custom_code"        VARCHAR(64),
  "custom_name"        VARCHAR(128),
  "custom_description" TEXT,
  "margin_pct"         DECIMAL(5,2)   NOT NULL,
  "fixed_surcharge"    DECIMAL(12,2),
  "is_active"          BOOLEAN        NOT NULL DEFAULT true,
  "feature_overrides"  JSONB,
  "created_at"         TIMESTAMP(6)   NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMP(6)   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "partner_plan_overrides_org_base_plan_key"
  ON "partner_plan_overrides" ("organization_id", "base_plan_id");
CREATE INDEX IF NOT EXISTS "partner_plan_overrides_organization_id_idx"
  ON "partner_plan_overrides" ("organization_id");

DO $$ BEGIN
  ALTER TABLE "partner_plan_overrides"
    ADD CONSTRAINT "partner_plan_overrides_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "partner_plan_overrides"
    ADD CONSTRAINT "partner_plan_overrides_base_plan_id_fkey"
    FOREIGN KEY ("base_plan_id") REFERENCES "subscription_plans"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.3 store_subscriptions ----------------------------------------------
CREATE TABLE IF NOT EXISTS "store_subscriptions" (
  "id"                      SERIAL                            PRIMARY KEY,
  "store_id"                INTEGER                           NOT NULL,
  "plan_id"                 INTEGER                           NOT NULL,
  "partner_override_id"     INTEGER,
  "state"                   "store_subscription_state_enum"   NOT NULL DEFAULT 'draft',
  "started_at"              TIMESTAMP(6),
  "trial_ends_at"           TIMESTAMP(6),
  "current_period_start"    TIMESTAMP(6),
  "current_period_end"      TIMESTAMP(6),
  "next_billing_at"         TIMESTAMP(6),
  "grace_soft_until"        TIMESTAMP(6),
  "grace_hard_until"        TIMESTAMP(6),
  "suspend_at"              TIMESTAMP(6),
  "cancel_at"               TIMESTAMP(6),
  "cancelled_at"            TIMESTAMP(6),
  "effective_price"         DECIMAL(12,2)                     NOT NULL,
  "vendix_base_price"       DECIMAL(12,2)                     NOT NULL,
  "partner_margin_amount"   DECIMAL(12,2)                     NOT NULL DEFAULT 0,
  "currency"                VARCHAR(3)                        NOT NULL DEFAULT 'COP',
  "auto_renew"              BOOLEAN                           NOT NULL DEFAULT true,
  "promotional_plan_id"     INTEGER,
  "promotional_applied_at"  TIMESTAMP(6),
  "resolved_features"       JSONB                             NOT NULL,
  "resolved_at"             TIMESTAMP(6)                      NOT NULL DEFAULT now(),
  "replaced_by_id"          INTEGER,
  "metadata"                JSONB,
  "created_at"              TIMESTAMP(6)                      NOT NULL DEFAULT now(),
  "updated_at"              TIMESTAMP(6)                      NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "store_subscriptions_store_id_key"
  ON "store_subscriptions" ("store_id");
CREATE INDEX IF NOT EXISTS "store_subscriptions_state_current_period_end_idx"
  ON "store_subscriptions" ("state", "current_period_end");
CREATE INDEX IF NOT EXISTS "store_subscriptions_plan_id_idx"
  ON "store_subscriptions" ("plan_id");
CREATE INDEX IF NOT EXISTS "store_subscriptions_next_billing_at_idx"
  ON "store_subscriptions" ("next_billing_at");

DO $$ BEGIN
  ALTER TABLE "store_subscriptions"
    ADD CONSTRAINT "store_subscriptions_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "store_subscriptions"
    ADD CONSTRAINT "store_subscriptions_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "store_subscriptions"
    ADD CONSTRAINT "store_subscriptions_partner_override_id_fkey"
    FOREIGN KEY ("partner_override_id") REFERENCES "partner_plan_overrides"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.4 subscription_invoices --------------------------------------------
CREATE TABLE IF NOT EXISTS "subscription_invoices" (
  "id"                        SERIAL                              PRIMARY KEY,
  "store_subscription_id"     INTEGER                             NOT NULL,
  "store_id"                  INTEGER                             NOT NULL,
  "partner_organization_id"   INTEGER,
  "invoice_number"            VARCHAR(64)                         NOT NULL,
  "state"                     "subscription_invoice_state_enum"   NOT NULL DEFAULT 'draft',
  "issued_at"                 TIMESTAMP(6),
  "due_at"                    TIMESTAMP(6)                        NOT NULL,
  "period_start"              TIMESTAMP(6)                        NOT NULL,
  "period_end"                TIMESTAMP(6)                        NOT NULL,
  "subtotal"                  DECIMAL(12,2)                       NOT NULL,
  "tax_amount"                DECIMAL(12,2)                       NOT NULL DEFAULT 0,
  "total"                     DECIMAL(12,2)                       NOT NULL,
  "amount_paid"               DECIMAL(12,2)                       NOT NULL DEFAULT 0,
  "currency"                  VARCHAR(3)                          NOT NULL DEFAULT 'COP',
  "line_items"                JSONB                               NOT NULL,
  "split_breakdown"           JSONB                               NOT NULL,
  "metadata"                  JSONB,
  "created_at"                TIMESTAMP(6)                        NOT NULL DEFAULT now(),
  "updated_at"                TIMESTAMP(6)                        NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoices_invoice_number_key"
  ON "subscription_invoices" ("invoice_number");
CREATE INDEX IF NOT EXISTS "subscription_invoices_state_due_at_idx"
  ON "subscription_invoices" ("state", "due_at");
CREATE INDEX IF NOT EXISTS "subscription_invoices_store_id_idx"
  ON "subscription_invoices" ("store_id");
CREATE INDEX IF NOT EXISTS "subscription_invoices_partner_org_state_idx"
  ON "subscription_invoices" ("partner_organization_id", "state");

DO $$ BEGIN
  ALTER TABLE "subscription_invoices"
    ADD CONSTRAINT "subscription_invoices_store_subscription_id_fkey"
    FOREIGN KEY ("store_subscription_id") REFERENCES "store_subscriptions"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.5 subscription_payments --------------------------------------------
CREATE TABLE IF NOT EXISTS "subscription_payments" (
  "id"                 SERIAL                              PRIMARY KEY,
  "invoice_id"         INTEGER                             NOT NULL,
  "state"              "subscription_payment_state_enum"   NOT NULL DEFAULT 'pending',
  "amount"             DECIMAL(12,2)                       NOT NULL,
  "currency"           VARCHAR(3)                          NOT NULL DEFAULT 'COP',
  "payment_method"     VARCHAR(64),
  "gateway_reference"  VARCHAR(255),
  "paid_at"            TIMESTAMP(6),
  "failure_reason"     TEXT,
  "metadata"           JSONB,
  "created_at"         TIMESTAMP(6)                        NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMP(6)                        NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "subscription_payments_invoice_id_state_idx"
  ON "subscription_payments" ("invoice_id", "state");

DO $$ BEGIN
  ALTER TABLE "subscription_payments"
    ADD CONSTRAINT "subscription_payments_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "subscription_invoices"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.6 partner_payout_batches (referenced by partner_commissions) ------
CREATE TABLE IF NOT EXISTS "partner_payout_batches" (
  "id"                       SERIAL         PRIMARY KEY,
  "partner_organization_id"  INTEGER        NOT NULL,
  "period_start"             TIMESTAMP(6)   NOT NULL,
  "period_end"               TIMESTAMP(6)   NOT NULL,
  "total_amount"             DECIMAL(12,2)  NOT NULL,
  "currency"                 VARCHAR(3)     NOT NULL DEFAULT 'COP',
  "state"                    VARCHAR(32)    NOT NULL,
  "sent_at"                  TIMESTAMP(6),
  "paid_at"                  TIMESTAMP(6),
  "payout_method"            VARCHAR(64)    NOT NULL,
  "reference"                VARCHAR(255),
  "metadata"                 JSONB,
  "created_at"               TIMESTAMP(6)   NOT NULL DEFAULT now(),
  "updated_at"               TIMESTAMP(6)   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "partner_payout_batches_partner_org_state_idx"
  ON "partner_payout_batches" ("partner_organization_id", "state");

DO $$ BEGIN
  ALTER TABLE "partner_payout_batches"
    ADD CONSTRAINT "partner_payout_batches_partner_organization_id_fkey"
    FOREIGN KEY ("partner_organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.7 partner_commissions ---------------------------------------------
CREATE TABLE IF NOT EXISTS "partner_commissions" (
  "id"                        SERIAL                           PRIMARY KEY,
  "partner_organization_id"   INTEGER                          NOT NULL,
  "invoice_id"                INTEGER                          NOT NULL,
  "amount"                    DECIMAL(12,2)                    NOT NULL,
  "currency"                  VARCHAR(3)                       NOT NULL DEFAULT 'COP',
  "state"                     "partner_commission_state_enum"  NOT NULL DEFAULT 'accrued',
  "accrued_at"                TIMESTAMP(6)                     NOT NULL DEFAULT now(),
  "paid_at"                   TIMESTAMP(6),
  "payout_reference"          VARCHAR(255),
  "payout_batch_id"           INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS "partner_commissions_invoice_id_key"
  ON "partner_commissions" ("invoice_id");
CREATE INDEX IF NOT EXISTS "partner_commissions_partner_org_state_idx"
  ON "partner_commissions" ("partner_organization_id", "state");

DO $$ BEGIN
  ALTER TABLE "partner_commissions"
    ADD CONSTRAINT "partner_commissions_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "subscription_invoices"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "partner_commissions"
    ADD CONSTRAINT "partner_commissions_partner_organization_id_fkey"
    FOREIGN KEY ("partner_organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "partner_commissions"
    ADD CONSTRAINT "partner_commissions_payout_batch_id_fkey"
    FOREIGN KEY ("payout_batch_id") REFERENCES "partner_payout_batches"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.8 subscription_events ---------------------------------------------
CREATE TABLE IF NOT EXISTS "subscription_events" (
  "id"                      SERIAL                            PRIMARY KEY,
  "store_subscription_id"   INTEGER                           NOT NULL,
  "type"                    "subscription_event_type_enum"    NOT NULL,
  "from_state"              "store_subscription_state_enum",
  "to_state"                "store_subscription_state_enum",
  "payload"                 JSONB,
  "triggered_by_user_id"    INTEGER,
  "triggered_by_job"        VARCHAR(64),
  "created_at"              TIMESTAMP(6)                      NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "subscription_events_store_sub_created_at_idx"
  ON "subscription_events" ("store_subscription_id", "created_at" DESC);

DO $$ BEGIN
  ALTER TABLE "subscription_events"
    ADD CONSTRAINT "subscription_events_store_subscription_id_fkey"
    FOREIGN KEY ("store_subscription_id") REFERENCES "store_subscriptions"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.9 platform_settings ------------------------------------------------
CREATE TABLE IF NOT EXISTS "platform_settings" (
  "id"                  SERIAL        PRIMARY KEY,
  "key"                 VARCHAR(64)   NOT NULL,
  "value"               JSONB         NOT NULL,
  "default_trial_days"  INTEGER       NOT NULL DEFAULT 14,
  "description"         TEXT,
  "created_at"          TIMESTAMP(6)  NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMP(6)  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_settings_key_key"
  ON "platform_settings" ("key");
