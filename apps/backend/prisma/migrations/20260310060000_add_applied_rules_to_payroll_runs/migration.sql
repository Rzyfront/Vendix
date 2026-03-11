-- AlterTable: Add applied_rules JSONB column to payroll_runs for rule snapshot auditing
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "applied_rules" JSONB;
