-- CreateEnum
CREATE TYPE "pricing_type_enum" AS ENUM ('unit', 'weight');

-- AlterEnum
ALTER TYPE "payments_state_enum" ADD VALUE 'cancelled';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "weight" DECIMAL(10,3),
ADD COLUMN     "weight_unit" VARCHAR(10);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "pricing_type" "pricing_type_enum" NOT NULL DEFAULT 'unit';
