/*
  Warnings:

  - You are about to drop the column `customer_id` on the `addresses` table. All the data in the column will be lost.
  - You are about to drop the column `logo_url` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `color_primary` on the `stores` table. All the data in the column will be lost.
  - You are about to drop the column `color_secondary` on the `stores` table. All the data in the column will be lost.
  - You are about to drop the column `currency_code` on the `stores` table. All the data in the column will be lost.
  - You are about to drop the column `domain` on the `stores` table. All the data in the column will be lost.
  - You are about to drop the column `logo_url` on the `stores` table. All the data in the column will be lost.
  - You are about to drop the column `operating_hours` on the `stores` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."address_type_enum" ADD VALUE 'home';
ALTER TYPE "public"."address_type_enum" ADD VALUE 'work';
ALTER TYPE "public"."address_type_enum" ADD VALUE 'contact';
ALTER TYPE "public"."address_type_enum" ADD VALUE 'mailing';
ALTER TYPE "public"."address_type_enum" ADD VALUE 'residential';
ALTER TYPE "public"."address_type_enum" ADD VALUE 'commercial';
ALTER TYPE "public"."address_type_enum" ADD VALUE 'pickup';
ALTER TYPE "public"."address_type_enum" ADD VALUE 'delivery';
ALTER TYPE "public"."address_type_enum" ADD VALUE 'emergency';
ALTER TYPE "public"."address_type_enum" ADD VALUE 'temporary';
ALTER TYPE "public"."address_type_enum" ADD VALUE 'vacation';
ALTER TYPE "public"."address_type_enum" ADD VALUE 'business';

-- AlterEnum
-- NOTE: The 'draft' value for organization_state_enum is now added in a prior migration

-- AlterTable
ALTER TABLE "public"."addresses" DROP COLUMN "customer_id",
ADD COLUMN     "user_id" INTEGER,
ALTER COLUMN "postal_code" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."domain_settings" ALTER COLUMN "organization_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."organizations" DROP COLUMN "logo_url",
ALTER COLUMN "state" SET DEFAULT 'draft';

-- AlterTable
ALTER TABLE "public"."stores" DROP COLUMN "color_primary",
DROP COLUMN "color_secondary",
DROP COLUMN "currency_code",
DROP COLUMN "domain",
DROP COLUMN "logo_url",
DROP COLUMN "operating_hours";

-- AddForeignKey
ALTER TABLE "public"."addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
