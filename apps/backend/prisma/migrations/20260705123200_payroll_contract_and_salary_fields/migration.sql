-- DATA IMPACT:
-- Tables affected: employees (adds 4 nullable/defaulted columns only)
-- Expected row changes: 0 rows mutated. birth_date, gender, contract_end_date are
--   NULLable (existing rows stay NULL); salary_type is NOT NULL DEFAULT 'ordinary'
--   so existing rows backfill to 'ordinary' (semantic no-op: default is the base case).
-- Enums affected: contract_type_enum (+obra_labor), payroll_novelty_type_enum
--   (+maternity_leave, +paternity_leave, +bereavement_leave); new enums salary_type_enum, gender_enum.
-- Destructive operations: none (only additive CREATE TYPE / ADD VALUE / ADD COLUMN)
-- FK/cascade risk: none
-- Idempotency: guarded with IF NOT EXISTS on enums, enum values, and columns
-- Approval: additive schema migration for Colombian payroll model expansion (Step 1)

-- 1) New enums (guarded create so re-runs are safe)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'salary_type_enum') THEN
    CREATE TYPE "salary_type_enum" AS ENUM ('ordinary', 'integral');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gender_enum') THEN
    CREATE TYPE "gender_enum" AS ENUM ('male', 'female', 'other');
  END IF;
END $$;

-- 2) contract_type_enum: add obra_labor (contrato por obra o labor)
ALTER TYPE "contract_type_enum" ADD VALUE IF NOT EXISTS 'obra_labor';

-- 3) payroll_novelty_type_enum: typed leaves for maternity/paternity/bereavement
--    (kept alongside the generic leave_paid/leave_unpaid values, which are NOT removed)
ALTER TYPE "payroll_novelty_type_enum" ADD VALUE IF NOT EXISTS 'maternity_leave';
ALTER TYPE "payroll_novelty_type_enum" ADD VALUE IF NOT EXISTS 'paternity_leave';
ALTER TYPE "payroll_novelty_type_enum" ADD VALUE IF NOT EXISTS 'bereavement_leave';

-- 4) employees columns (additive; no data mutation beyond salary_type default backfill)
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "birth_date" DATE;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "gender" "gender_enum";
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "contract_end_date" DATE;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "salary_type" "salary_type_enum" NOT NULL DEFAULT 'ordinary';
