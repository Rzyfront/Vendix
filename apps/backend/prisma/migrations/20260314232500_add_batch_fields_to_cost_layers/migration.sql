-- AlterTable
ALTER TABLE "inventory_cost_layers" ADD COLUMN IF NOT EXISTS "batch_number" VARCHAR(100),
ADD COLUMN IF NOT EXISTS "manufacturing_date" TIMESTAMP(6),
ADD COLUMN IF NOT EXISTS "expiration_date" TIMESTAMP(6);
