-- CreateEnum
CREATE TYPE "order_delivery_type_enum" AS ENUM ('pickup', 'home_delivery', 'direct_delivery', 'other');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "delivery_type" "order_delivery_type_enum" NOT NULL DEFAULT 'direct_delivery';
