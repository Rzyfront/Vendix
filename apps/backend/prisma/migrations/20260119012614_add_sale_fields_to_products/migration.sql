/*
  Warnings:

  - You are about to drop the column `created_at` on the `currencies` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `currencies` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "carts" DROP CONSTRAINT "carts_currency_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_currency_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_currency_fkey";

-- DropForeignKey
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_currency_fkey";

-- DropForeignKey
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_currency_fkey";

-- DropIndex
DROP INDEX "currencies_code_idx";

-- DropIndex
DROP INDEX "currencies_state_idx";

-- AlterTable
ALTER TABLE "currencies" DROP COLUMN "created_at",
DROP COLUMN "updated_at";

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "is_on_sale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sale_price" DECIMAL(12,2);
