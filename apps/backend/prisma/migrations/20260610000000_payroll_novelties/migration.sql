-- DATA IMPACT:
-- Tables affected: payroll_novelties (new table), employees (additive optional columns)
-- Expected row changes: 0 destructive row mutations. Purely additive: new enums, new table, new nullable columns.
--   employees.country_code DEFAULT '169' (DIAN code for Colombia) backfills existing rows via fast
--   metadata-only ADD COLUMN DEFAULT (PG11+), matching Prisma @default("169") semantics.
-- Destructive operations: none. No DROP, TRUNCATE, DELETE, or UPDATE.
-- FK/cascade risk: new FKs only on the NEW payroll_novelties table (org/store/employee CASCADE,
--   payroll_run/created_by_user SET NULL). No FK changes on existing tables.
-- Idempotency: guarded CREATE TYPE (pg_type checks), CREATE TABLE IF NOT EXISTS,
--   CREATE INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, guarded FK constraints via pg_constraint.
-- Approval: Paso 1 of approved plan whimsical-discovering-alpaca (payroll novelties base).

-- ===== Enums =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payroll_novelty_type_enum') THEN
    CREATE TYPE "payroll_novelty_type_enum" AS ENUM (
      'overtime_diurna',
      'overtime_nocturna',
      'overtime_dominical_diurna',
      'overtime_dominical_nocturna',
      'surcharge_nocturno',
      'surcharge_dominical',
      'incapacity_general',
      'incapacity_laboral',
      'vacation',
      'leave_paid',
      'leave_unpaid',
      'bonus',
      'commission',
      'other_deduction'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payroll_novelty_status_enum') THEN
    CREATE TYPE "payroll_novelty_status_enum" AS ENUM ('pending', 'applied', 'cancelled');
  END IF;
END $$;

-- ===== Table =====
CREATE TABLE IF NOT EXISTS "payroll_novelties" (
  "id" SERIAL NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "employee_id" INTEGER NOT NULL,
  "payroll_run_id" INTEGER,
  "novelty_type" "payroll_novelty_type_enum" NOT NULL,
  "status" "payroll_novelty_status_enum" NOT NULL DEFAULT 'pending',
  "date_start" TIMESTAMP(6) NOT NULL,
  "date_end" TIMESTAMP(6),
  "hours" DECIMAL(6,2),
  "days" DECIMAL(5,2),
  "percentage" DECIMAL(7,4),
  "amount" DECIMAL(12,2),
  "notes" VARCHAR(255),
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_novelties_pkey" PRIMARY KEY ("id")
);

-- ===== Indexes =====
CREATE INDEX IF NOT EXISTS "payroll_novelties_organization_id_employee_id_status_idx"
  ON "payroll_novelties" ("organization_id", "employee_id", "status");

CREATE INDEX IF NOT EXISTS "payroll_novelties_payroll_run_id_idx"
  ON "payroll_novelties" ("payroll_run_id");

CREATE INDEX IF NOT EXISTS "payroll_novelties_organization_id_date_start_idx"
  ON "payroll_novelties" ("organization_id", "date_start");

CREATE INDEX IF NOT EXISTS "payroll_novelties_store_id_idx"
  ON "payroll_novelties" ("store_id");

-- ===== Foreign Keys (guarded) =====
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payroll_novelties_organization_id_fkey'
  ) THEN
    ALTER TABLE "payroll_novelties"
      ADD CONSTRAINT "payroll_novelties_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payroll_novelties_store_id_fkey'
  ) THEN
    ALTER TABLE "payroll_novelties"
      ADD CONSTRAINT "payroll_novelties_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payroll_novelties_employee_id_fkey'
  ) THEN
    ALTER TABLE "payroll_novelties"
      ADD CONSTRAINT "payroll_novelties_employee_id_fkey"
      FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payroll_novelties_payroll_run_id_fkey'
  ) THEN
    ALTER TABLE "payroll_novelties"
      ADD CONSTRAINT "payroll_novelties_payroll_run_id_fkey"
      FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payroll_novelties_created_by_user_id_fkey'
  ) THEN
    ALTER TABLE "payroll_novelties"
      ADD CONSTRAINT "payroll_novelties_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- ===== employees: optional DIAN/PILA address columns =====
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "address" VARCHAR(255);
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "department_code" VARCHAR(5);
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "city_code" VARCHAR(10);
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "country_code" VARCHAR(4) DEFAULT '169';
