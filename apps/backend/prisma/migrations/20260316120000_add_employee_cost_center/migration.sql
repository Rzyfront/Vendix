-- CreateEnum
CREATE TYPE "cost_center_enum" AS ENUM ('operational', 'administrative', 'sales');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN "cost_center" "cost_center_enum" NOT NULL DEFAULT 'administrative';
