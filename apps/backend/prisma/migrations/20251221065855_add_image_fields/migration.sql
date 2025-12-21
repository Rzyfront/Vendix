/*
  Warnings:

  - You are about to drop the column `category_id` on the `products` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_category_id_fkey";

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "logo_url" TEXT;

-- AlterTable
ALTER TABLE "products" DROP COLUMN "category_id";

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "payment_terms" VARCHAR(255),
ADD COLUMN     "shipping_cost" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "shipping_method" VARCHAR(100);

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "logo_url" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "contact_person" VARCHAR(255),
ADD COLUMN     "currency" VARCHAR(10),
ADD COLUMN     "mobile" VARCHAR(50),
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_url" TEXT;
