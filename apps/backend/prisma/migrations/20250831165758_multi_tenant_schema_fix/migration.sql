/*
  Warnings:

  - You are about to drop the column `store_id` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `customers` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `organization_users` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `store_staff` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `store_id` to the `login_attempts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `organization_id` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "public"."addresses" DROP CONSTRAINT "addresses_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."customers" DROP CONSTRAINT "customers_store_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."customers" DROP CONSTRAINT "customers_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."organization_users" DROP CONSTRAINT "organization_users_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."organization_users" DROP CONSTRAINT "organization_users_role_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."organization_users" DROP CONSTRAINT "organization_users_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."payments" DROP CONSTRAINT "payments_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."refunds" DROP CONSTRAINT "refunds_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."store_staff" DROP CONSTRAINT "store_staff_role_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."store_staff" DROP CONSTRAINT "store_staff_store_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."store_staff" DROP CONSTRAINT "store_staff_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."stores" DROP CONSTRAINT "stores_manager_user_id_fkey";

-- DropIndex
DROP INDEX "public"."users_email_key";

-- AlterTable
ALTER TABLE "public"."login_attempts" ADD COLUMN     "store_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "public"."users" DROP COLUMN "store_id",
ADD COLUMN     "organization_id" INTEGER NOT NULL;

-- DropTable
DROP TABLE "public"."customers";

-- DropTable
DROP TABLE "public"."organization_users";

-- DropTable
DROP TABLE "public"."store_staff";

-- CreateTable
CREATE TABLE "public"."store_users" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_users_store_id_user_id_key" ON "public"."store_users"("store_id", "user_id");

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."store_users" ADD CONSTRAINT "store_users_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."store_users" ADD CONSTRAINT "store_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."login_attempts" ADD CONSTRAINT "login_attempts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
