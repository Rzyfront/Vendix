-- AlterTable: Add provisions column to payroll_items (nullable, safe)
ALTER TABLE "payroll_items" ADD COLUMN IF NOT EXISTS "provisions" JSONB;
