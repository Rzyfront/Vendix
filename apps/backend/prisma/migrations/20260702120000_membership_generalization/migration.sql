-- DATA IMPACT:
-- Tables affected: gym_plans, gym_memberships, gym_member_profiles,
--   gym_access_credentials, gym_access_logs (RENAMED to membership_*; rows preserved).
-- Row changes:
--   * memberships.kind / membership_plans.kind: new column, backfilled to 'gym' for
--     all pre-existing rows (they were gym data).
--   * membership_plans.features: access_limit_per_period + class_limit_per_period are
--     COPIED into features JSON *before* the columns are dropped (semantics preserved).
-- Destructive operations: DROP COLUMN access_limit_per_period, class_limit_per_period
--   on membership_plans — value migrated into features first, so no data is lost.
-- FK/cascade risk: FK constraints renamed in place; ON DELETE behavior unchanged; no CASCADE added.
-- Idempotency: every statement guarded (ALTER TABLE/INDEX IF EXISTS, ADD/DROP COLUMN IF EXISTS,
--   DO $$ existence checks on pg_type / pg_enum / pg_attribute / pg_constraint). Safe to re-run.
-- Approval: rename-total (Opción A) explicitly approved by user; goal "implementa todas las
--   mejoras al 100%". Dev DB only at authoring time; prod has no gym data yet.

-- ============================================================================
-- 1) ENUM TYPE RENAMES (gym_* -> membership_*)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gym_membership_status_enum')
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_status_enum') THEN
    ALTER TYPE "gym_membership_status_enum" RENAME TO "membership_status_enum";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gym_credential_type_enum')
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_credential_type_enum') THEN
    ALTER TYPE "gym_credential_type_enum" RENAME TO "membership_credential_type_enum";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gym_access_result_enum')
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_access_result_enum') THEN
    ALTER TYPE "gym_access_result_enum" RENAME TO "membership_access_result_enum";
  END IF;
END $$;

-- ============================================================================
-- 2) NEW ENUM membership_kind_enum
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_kind_enum') THEN
    CREATE TYPE "membership_kind_enum" AS ENUM ('generic', 'gym', 'service');
  END IF;
END $$;

-- ============================================================================
-- 3) notification_type_enum VALUE RENAMES (gym_membership_* -> membership_*)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'gym_membership_expiring'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'membership_expiring'
  ) THEN
    ALTER TYPE "notification_type_enum" RENAME VALUE 'gym_membership_expiring' TO 'membership_expiring';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'gym_membership_expired'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'membership_expired'
  ) THEN
    ALTER TYPE "notification_type_enum" RENAME VALUE 'gym_membership_expired' TO 'membership_expired';
  END IF;
END $$;

-- ============================================================================
-- 4) TABLE RENAMES (gym_* -> membership_*)
-- ============================================================================
ALTER TABLE IF EXISTS "gym_plans" RENAME TO "membership_plans";
ALTER TABLE IF EXISTS "gym_memberships" RENAME TO "memberships";
ALTER TABLE IF EXISTS "gym_member_profiles" RENAME TO "membership_profiles";
ALTER TABLE IF EXISTS "gym_access_credentials" RENAME TO "membership_access_credentials";
ALTER TABLE IF EXISTS "gym_access_logs" RENAME TO "membership_access_logs";

-- ============================================================================
-- 5) COLUMN RENAME memberships.gym_plan_id -> plan_id
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'memberships'::regclass AND attname = 'gym_plan_id' AND NOT attisdropped
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'memberships'::regclass AND attname = 'plan_id' AND NOT attisdropped
  ) THEN
    ALTER TABLE "memberships" RENAME COLUMN "gym_plan_id" TO "plan_id";
  END IF;
END $$;

-- ============================================================================
-- 6) ADD `kind` DISCRIMINATOR + backfill existing rows to 'gym'
-- ============================================================================
ALTER TABLE "membership_plans" ADD COLUMN IF NOT EXISTS "kind" "membership_kind_enum" NOT NULL DEFAULT 'generic';
ALTER TABLE "memberships"      ADD COLUMN IF NOT EXISTS "kind" "membership_kind_enum" NOT NULL DEFAULT 'generic';

-- Pre-existing rows are gym data (this table was born as the gym suite).
UPDATE "membership_plans" SET "kind" = 'gym' WHERE "kind" = 'generic';
UPDATE "memberships"      SET "kind" = 'gym' WHERE "kind" = 'generic';

-- ============================================================================
-- 7) MOVE per-period limits into features JSON, then drop the columns
--    Guarded on column existence so re-running after the drop is a safe no-op.
--    Null-safe merge: `||` + jsonb_strip_nulls(jsonb_build_object(...)) — NEVER
--    jsonb_set(doc, path, to_jsonb(nullable)) which collapses the whole document
--    to NULL when the column is NULL (Postgres jsonb_set is STRICT on new_value).
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'membership_plans'::regclass
      AND attname IN ('access_limit_per_period', 'class_limit_per_period')
      AND NOT attisdropped
  ) THEN
    UPDATE "membership_plans"
    SET "features" =
      (CASE WHEN jsonb_typeof("features") = 'object' THEN "features" ELSE '{}'::jsonb END)
      || jsonb_strip_nulls(jsonb_build_object(
           'access_limit_per_period', "access_limit_per_period",
           'class_limit_per_period',  "class_limit_per_period"
         ))
    WHERE "access_limit_per_period" IS NOT NULL OR "class_limit_per_period" IS NOT NULL;

    ALTER TABLE "membership_plans" DROP COLUMN IF EXISTS "access_limit_per_period";
    ALTER TABLE "membership_plans" DROP COLUMN IF EXISTS "class_limit_per_period";
  END IF;
END $$;

-- ============================================================================
-- 8) RENAME PRIMARY KEY CONSTRAINTS (Prisma expects <table>_pkey)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_plans_pkey') THEN
    ALTER TABLE "membership_plans" RENAME CONSTRAINT "gym_plans_pkey" TO "membership_plans_pkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_memberships_pkey') THEN
    ALTER TABLE "memberships" RENAME CONSTRAINT "gym_memberships_pkey" TO "memberships_pkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_member_profiles_pkey') THEN
    ALTER TABLE "membership_profiles" RENAME CONSTRAINT "gym_member_profiles_pkey" TO "membership_profiles_pkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_access_credentials_pkey') THEN
    ALTER TABLE "membership_access_credentials" RENAME CONSTRAINT "gym_access_credentials_pkey" TO "membership_access_credentials_pkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_access_logs_pkey') THEN
    ALTER TABLE "membership_access_logs" RENAME CONSTRAINT "gym_access_logs_pkey" TO "membership_access_logs_pkey";
  END IF;
END $$;

-- ============================================================================
-- 9) RENAME FOREIGN KEY CONSTRAINTS (cosmetic coherence; Prisma ignores scalar FKs)
-- ============================================================================
DO $$
BEGIN
  -- membership_plans
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_plans_product_id_fkey') THEN
    ALTER TABLE "membership_plans" RENAME CONSTRAINT "gym_plans_product_id_fkey" TO "membership_plans_product_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_plans_store_id_fkey') THEN
    ALTER TABLE "membership_plans" RENAME CONSTRAINT "gym_plans_store_id_fkey" TO "membership_plans_store_id_fkey";
  END IF;
  -- memberships
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_memberships_store_id_fkey') THEN
    ALTER TABLE "memberships" RENAME CONSTRAINT "gym_memberships_store_id_fkey" TO "memberships_store_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_memberships_customer_id_fkey') THEN
    ALTER TABLE "memberships" RENAME CONSTRAINT "gym_memberships_customer_id_fkey" TO "memberships_customer_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_memberships_gym_plan_id_fkey') THEN
    ALTER TABLE "memberships" RENAME CONSTRAINT "gym_memberships_gym_plan_id_fkey" TO "memberships_plan_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_memberships_source_order_id_fkey') THEN
    ALTER TABLE "memberships" RENAME CONSTRAINT "gym_memberships_source_order_id_fkey" TO "memberships_source_order_id_fkey";
  END IF;
  -- membership_profiles
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_member_profiles_customer_id_fkey') THEN
    ALTER TABLE "membership_profiles" RENAME CONSTRAINT "gym_member_profiles_customer_id_fkey" TO "membership_profiles_customer_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_member_profiles_store_id_fkey') THEN
    ALTER TABLE "membership_profiles" RENAME CONSTRAINT "gym_member_profiles_store_id_fkey" TO "membership_profiles_store_id_fkey";
  END IF;
  -- membership_access_credentials
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_access_credentials_customer_id_fkey') THEN
    ALTER TABLE "membership_access_credentials" RENAME CONSTRAINT "gym_access_credentials_customer_id_fkey" TO "membership_access_credentials_customer_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_access_credentials_store_id_fkey') THEN
    ALTER TABLE "membership_access_credentials" RENAME CONSTRAINT "gym_access_credentials_store_id_fkey" TO "membership_access_credentials_store_id_fkey";
  END IF;
  -- membership_access_logs
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_access_logs_membership_id_fkey') THEN
    ALTER TABLE "membership_access_logs" RENAME CONSTRAINT "gym_access_logs_membership_id_fkey" TO "membership_access_logs_membership_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_access_logs_customer_id_fkey') THEN
    ALTER TABLE "membership_access_logs" RENAME CONSTRAINT "gym_access_logs_customer_id_fkey" TO "membership_access_logs_customer_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_access_logs_credential_id_fkey') THEN
    ALTER TABLE "membership_access_logs" RENAME CONSTRAINT "gym_access_logs_credential_id_fkey" TO "membership_access_logs_credential_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_access_logs_store_id_fkey') THEN
    ALTER TABLE "membership_access_logs" RENAME CONSTRAINT "gym_access_logs_store_id_fkey" TO "membership_access_logs_store_id_fkey";
  END IF;
END $$;

-- ============================================================================
-- 10) RENAME INDEXES (unique + regular; Prisma expects the membership_* names)
-- ============================================================================
ALTER INDEX IF EXISTS "gym_plans_store_id_code_key"                  RENAME TO "membership_plans_store_id_code_key";
ALTER INDEX IF EXISTS "gym_plans_store_id_idx"                       RENAME TO "membership_plans_store_id_idx";
ALTER INDEX IF EXISTS "gym_plans_store_id_is_active_idx"             RENAME TO "membership_plans_store_id_is_active_idx";

ALTER INDEX IF EXISTS "gym_memberships_store_id_customer_id_idx"     RENAME TO "memberships_store_id_customer_id_idx";
ALTER INDEX IF EXISTS "gym_memberships_store_id_status_idx"          RENAME TO "memberships_store_id_status_idx";
ALTER INDEX IF EXISTS "gym_memberships_store_id_period_end_idx"      RENAME TO "memberships_store_id_period_end_idx";
ALTER INDEX IF EXISTS "gym_memberships_gym_plan_id_idx"              RENAME TO "memberships_plan_id_idx";

ALTER INDEX IF EXISTS "gym_member_profiles_store_id_customer_id_key" RENAME TO "membership_profiles_store_id_customer_id_key";
ALTER INDEX IF EXISTS "gym_member_profiles_store_id_idx"             RENAME TO "membership_profiles_store_id_idx";

ALTER INDEX IF EXISTS "gym_access_cred_uq"                           RENAME TO "membership_access_cred_uq";
ALTER INDEX IF EXISTS "gym_access_credentials_store_id_customer_id_idx" RENAME TO "membership_access_credentials_store_id_customer_id_idx";

ALTER INDEX IF EXISTS "gym_access_logs_store_id_access_at_idx"       RENAME TO "membership_access_logs_store_id_access_at_idx";
ALTER INDEX IF EXISTS "gym_access_logs_store_id_customer_id_idx"     RENAME TO "membership_access_logs_store_id_customer_id_idx";

-- ============================================================================
-- 11) NEW INDEX for the kind discriminator on membership_plans
-- ============================================================================
CREATE INDEX IF NOT EXISTS "membership_plans_store_id_kind_idx" ON "membership_plans"("store_id", "kind");
