-- CreateEnum: employee_store_status_enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employee_store_status_enum') THEN
    CREATE TYPE "employee_store_status_enum" AS ENUM ('active', 'inactive');
  END IF;
END
$$;

-- CreateTable: employee_stores (junction table for employees <-> stores N:N)
CREATE TABLE IF NOT EXISTS "employee_stores" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" "employee_store_status_enum" NOT NULL DEFAULT 'active',
    "assigned_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_stores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "employee_stores_employee_id_store_id_key" ON "employee_stores"("employee_id", "store_id");
CREATE INDEX IF NOT EXISTS "employee_stores_store_id_idx" ON "employee_stores"("store_id");
CREATE INDEX IF NOT EXISTS "employee_stores_employee_id_status_idx" ON "employee_stores"("employee_id", "status");

-- AddForeignKey
ALTER TABLE "employee_stores" ADD CONSTRAINT "employee_stores_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_stores" ADD CONSTRAINT "employee_stores_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- MigrateData: Backfill employee_stores from employees.store_id
INSERT INTO "employee_stores" ("employee_id", "store_id", "is_primary", "status", "assigned_at")
SELECT "id", "store_id", true, 'active', COALESCE("created_at", NOW())
FROM "employees"
WHERE "store_id" IS NOT NULL
ON CONFLICT ("employee_id", "store_id") DO NOTHING;

-- DropForeignKey: employees.store_id
ALTER TABLE "employees" DROP CONSTRAINT IF EXISTS "employees_store_id_fkey";

-- DropIndex: employees_store_id_idx
DROP INDEX IF EXISTS "employees_store_id_idx";

-- AlterTable: Remove store_id from employees
ALTER TABLE "employees" DROP COLUMN IF EXISTS "store_id";
