/*
  Warnings:

  - You are about to drop the column `payment_method_id` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the `payment_methods` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "fee_type_enum" AS ENUM ('fixed', 'percentage', 'mixed');

-- DropForeignKey
ALTER TABLE "payment_methods" DROP CONSTRAINT "payment_methods_store_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_payment_method_id_fkey";

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "payment_method_id",
ADD COLUMN     "store_payment_method_id" INTEGER;

-- DropTable
DROP TABLE "payment_methods";

-- CreateTable
CREATE TABLE "system_payment_methods" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "type" "payment_methods_type_enum" NOT NULL,
    "provider" VARCHAR(100) NOT NULL,
    "logo_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "requires_config" BOOLEAN NOT NULL DEFAULT false,
    "config_schema" JSONB,
    "default_config" JSONB,
    "supported_currencies" TEXT[],
    "min_amount" DECIMAL(12,2),
    "max_amount" DECIMAL(12,2),
    "processing_fee_type" "fee_type_enum",
    "processing_fee_value" DECIMAL(12,4),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_payment_methods" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "system_payment_method_id" INTEGER NOT NULL,
    "display_name" VARCHAR(100),
    "custom_config" JSONB,
    "state" "payment_method_state_enum" NOT NULL DEFAULT 'enabled',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "min_amount" DECIMAL(12,2),
    "max_amount" DECIMAL(12,2),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "system_payment_methods_name_key" ON "system_payment_methods"("name");

-- CreateIndex
CREATE INDEX "store_payment_methods_store_id_state_idx" ON "store_payment_methods"("store_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "store_payment_methods_store_id_system_payment_method_id_key" ON "store_payment_methods"("store_id", "system_payment_method_id");

-- AddForeignKey
ALTER TABLE "store_payment_methods" ADD CONSTRAINT "store_payment_methods_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "store_payment_methods" ADD CONSTRAINT "store_payment_methods_system_payment_method_id_fkey" FOREIGN KEY ("system_payment_method_id") REFERENCES "system_payment_methods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_store_payment_method_id_fkey" FOREIGN KEY ("store_payment_method_id") REFERENCES "store_payment_methods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
