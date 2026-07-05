-- DATA IMPACT:
-- Tables affected: creates gym_plans, gym_memberships, gym_member_profiles,
--   gym_access_credentials, gym_access_logs (all NEW, start empty).
-- Enum changes: industry_enum += 'gym' (idempotent ADD VALUE); new enums
--   gym_membership_status_enum, gym_credential_type_enum, gym_access_result_enum.
-- Expected row changes: none (additive DDL only; no UPDATE/DELETE on existing rows).
-- Destructive operations: none (no DROP / TRUNCATE / unscoped DELETE-UPDATE).
-- FK/cascade risk: FKs to business parents (stores/users/orders/products/gym_plans)
--   use ON DELETE RESTRICT (hard refs) or SET NULL (nullable/audit refs). NO cascade
--   on business parents (respects CLAUDE.md §6.1). 'gym' value is NOT used in this
--   migration's DDL, so the Postgres same-transaction ADD VALUE restriction does not apply.
-- Idempotency: guarded with IF NOT EXISTS / pg_type / pg_constraint checks — safe to re-run.
-- Approval: gym industry epic (Ola 1), executed on dev.

-- 1) industry_enum += gym (idempotent, standalone add — value unused below)
ALTER TYPE "industry_enum" ADD VALUE IF NOT EXISTS 'gym';

-- 2) New gym enums (guarded CREATE TYPE)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gym_membership_status_enum') THEN
    CREATE TYPE "gym_membership_status_enum" AS ENUM ('active', 'expired', 'suspended', 'frozen', 'pending_payment', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gym_credential_type_enum') THEN
    CREATE TYPE "gym_credential_type_enum" AS ENUM ('qr', 'pin', 'external_ref');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gym_access_result_enum') THEN
    CREATE TYPE "gym_access_result_enum" AS ENUM ('granted', 'denied_no_membership', 'denied_expired', 'denied_suspended', 'denied_frozen', 'denied_quota_exceeded');
  END IF;
END $$;

-- 3) Tables (IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS "gym_plans" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'COP',
    "duration_days" INTEGER NOT NULL DEFAULT 30,
    "access_limit_per_period" INTEGER,
    "class_limit_per_period" INTEGER,
    "features" JSONB,
    "product_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gym_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "gym_memberships" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "gym_plan_id" INTEGER NOT NULL,
    "status" "gym_membership_status_enum" NOT NULL DEFAULT 'pending_payment',
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "source_order_id" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gym_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "gym_member_profiles" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "date_of_birth" DATE,
    "gender" VARCHAR(20),
    "emergency_contact_name" VARCHAR(160),
    "emergency_contact_phone" VARCHAR(40),
    "medical_notes" TEXT,
    "goals" TEXT,
    "height_cm" INTEGER,
    "weight_kg" DECIMAL(5,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gym_member_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "gym_access_credentials" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "credential_type" "gym_credential_type_enum" NOT NULL,
    "credential_value" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gym_access_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "gym_access_logs" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER,
    "membership_id" INTEGER,
    "credential_id" INTEGER,
    "result" "gym_access_result_enum" NOT NULL,
    "reason" VARCHAR(120),
    "device_id" VARCHAR(120),
    "access_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gym_access_logs_pkey" PRIMARY KEY ("id")
);

-- 4) Indexes (IF NOT EXISTS — names match Prisma default conventions)
CREATE UNIQUE INDEX IF NOT EXISTS "gym_plans_store_id_code_key" ON "gym_plans"("store_id", "code");
CREATE INDEX IF NOT EXISTS "gym_plans_store_id_idx" ON "gym_plans"("store_id");
CREATE INDEX IF NOT EXISTS "gym_plans_store_id_is_active_idx" ON "gym_plans"("store_id", "is_active");

CREATE INDEX IF NOT EXISTS "gym_memberships_store_id_customer_id_idx" ON "gym_memberships"("store_id", "customer_id");
CREATE INDEX IF NOT EXISTS "gym_memberships_store_id_status_idx" ON "gym_memberships"("store_id", "status");
CREATE INDEX IF NOT EXISTS "gym_memberships_store_id_period_end_idx" ON "gym_memberships"("store_id", "period_end");
CREATE INDEX IF NOT EXISTS "gym_memberships_gym_plan_id_idx" ON "gym_memberships"("gym_plan_id");

CREATE UNIQUE INDEX IF NOT EXISTS "gym_member_profiles_store_id_customer_id_key" ON "gym_member_profiles"("store_id", "customer_id");
CREATE INDEX IF NOT EXISTS "gym_member_profiles_store_id_idx" ON "gym_member_profiles"("store_id");

CREATE UNIQUE INDEX IF NOT EXISTS "gym_access_cred_uq" ON "gym_access_credentials"("store_id", "credential_type", "credential_value");
CREATE INDEX IF NOT EXISTS "gym_access_credentials_store_id_customer_id_idx" ON "gym_access_credentials"("store_id", "customer_id");

CREATE INDEX IF NOT EXISTS "gym_access_logs_store_id_access_at_idx" ON "gym_access_logs"("store_id", "access_at");
CREATE INDEX IF NOT EXISTS "gym_access_logs_store_id_customer_id_idx" ON "gym_access_logs"("store_id", "customer_id");

-- 5) Foreign keys (guarded via pg_constraint; RESTRICT on business parents, SET NULL on nullable/audit refs)
DO $$
BEGIN
  -- gym_plans
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_plans_store_id_fkey') THEN
    ALTER TABLE "gym_plans" ADD CONSTRAINT "gym_plans_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_plans_product_id_fkey') THEN
    ALTER TABLE "gym_plans" ADD CONSTRAINT "gym_plans_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- gym_memberships
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_memberships_store_id_fkey') THEN
    ALTER TABLE "gym_memberships" ADD CONSTRAINT "gym_memberships_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_memberships_customer_id_fkey') THEN
    ALTER TABLE "gym_memberships" ADD CONSTRAINT "gym_memberships_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_memberships_gym_plan_id_fkey') THEN
    ALTER TABLE "gym_memberships" ADD CONSTRAINT "gym_memberships_gym_plan_id_fkey" FOREIGN KEY ("gym_plan_id") REFERENCES "gym_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_memberships_source_order_id_fkey') THEN
    ALTER TABLE "gym_memberships" ADD CONSTRAINT "gym_memberships_source_order_id_fkey" FOREIGN KEY ("source_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- gym_member_profiles
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_member_profiles_store_id_fkey') THEN
    ALTER TABLE "gym_member_profiles" ADD CONSTRAINT "gym_member_profiles_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_member_profiles_customer_id_fkey') THEN
    ALTER TABLE "gym_member_profiles" ADD CONSTRAINT "gym_member_profiles_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- gym_access_credentials
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_access_credentials_store_id_fkey') THEN
    ALTER TABLE "gym_access_credentials" ADD CONSTRAINT "gym_access_credentials_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_access_credentials_customer_id_fkey') THEN
    ALTER TABLE "gym_access_credentials" ADD CONSTRAINT "gym_access_credentials_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- gym_access_logs (audit: nullable refs SET NULL so the log survives)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_access_logs_store_id_fkey') THEN
    ALTER TABLE "gym_access_logs" ADD CONSTRAINT "gym_access_logs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_access_logs_customer_id_fkey') THEN
    ALTER TABLE "gym_access_logs" ADD CONSTRAINT "gym_access_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_access_logs_membership_id_fkey') THEN
    ALTER TABLE "gym_access_logs" ADD CONSTRAINT "gym_access_logs_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "gym_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gym_access_logs_credential_id_fkey') THEN
    ALTER TABLE "gym_access_logs" ADD CONSTRAINT "gym_access_logs_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "gym_access_credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
