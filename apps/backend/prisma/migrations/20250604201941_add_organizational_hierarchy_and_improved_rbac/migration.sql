/*
  Warnings:

  - The values [archived] on the enum `api_key_status_enum` will be removed. If these variants are still used in the database, this will fail.
  - The values [archived] on the enum `permission_status_enum` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[store_code]` on the table `stores` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[organization_id,slug]` on the table `stores` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `organization_id` to the `stores` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "organization_state_enum" AS ENUM ('active', 'inactive', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "store_type_enum" AS ENUM ('physical', 'online', 'hybrid', 'popup', 'kiosko');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "address_type_enum" ADD VALUE 'headquarters';
ALTER TYPE "address_type_enum" ADD VALUE 'branch_office';
ALTER TYPE "address_type_enum" ADD VALUE 'warehouse';
ALTER TYPE "address_type_enum" ADD VALUE 'legal';
ALTER TYPE "address_type_enum" ADD VALUE 'store_physical';

-- AlterEnum
BEGIN;
CREATE TYPE "api_key_status_enum_new" AS ENUM ('active', 'inactive', 'revoked', 'expired');
ALTER TABLE "api_keys" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "api_keys" ALTER COLUMN "status" TYPE "api_key_status_enum_new" USING ("status"::text::"api_key_status_enum_new");
ALTER TYPE "api_key_status_enum" RENAME TO "api_key_status_enum_old";
ALTER TYPE "api_key_status_enum_new" RENAME TO "api_key_status_enum";
DROP TYPE "api_key_status_enum_old";
ALTER TABLE "api_keys" ALTER COLUMN "status" SET DEFAULT 'active';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "permission_status_enum_new" AS ENUM ('active', 'inactive', 'deprecated');
ALTER TABLE "permissions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "permissions" ALTER COLUMN "status" TYPE "permission_status_enum_new" USING ("status"::text::"permission_status_enum_new");
ALTER TYPE "permission_status_enum" RENAME TO "permission_status_enum_old";
ALTER TYPE "permission_status_enum_new" RENAME TO "permission_status_enum";
DROP TYPE "permission_status_enum_old";
ALTER TABLE "permissions" ALTER COLUMN "status" SET DEFAULT 'active';
COMMIT;

-- DropIndex
DROP INDEX "stores_slug_key";

-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "is_primary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "latitude" DECIMAL(10,8),
ADD COLUMN     "longitude" DECIMAL(11,8),
ADD COLUMN     "organization_id" INTEGER;

-- AlterTable
ALTER TABLE "login_attempts" ALTER COLUMN "ip_address" DROP NOT NULL;

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "currency_code" VARCHAR(3),
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "manager_user_id" INTEGER,
ADD COLUMN     "operating_hours" JSONB,
ADD COLUMN     "organization_id" INTEGER NOT NULL,
ADD COLUMN     "store_code" VARCHAR(20),
ADD COLUMN     "store_type" "store_type_enum" NOT NULL DEFAULT 'physical',
ADD COLUMN     "timezone" VARCHAR(50);

-- CreateTable
CREATE TABLE "organizations" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "legal_name" VARCHAR(255),
    "tax_id" VARCHAR(50),
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(50),
    "website" VARCHAR(255),
    "logo_url" TEXT,
    "description" TEXT,
    "state" "organization_state_enum" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_users" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role_id" INTEGER NOT NULL,
    "permissions" JSONB,
    "joined_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "organization_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_staff" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role_id" INTEGER NOT NULL,
    "permissions" JSONB,
    "hire_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "assigned_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_staff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_tax_id_key" ON "organizations"("tax_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_users_user_id_role_id_organization_id_key" ON "organization_users"("user_id", "role_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_staff_user_id_role_id_store_id_key" ON "store_staff"("user_id", "role_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "stores_store_code_key" ON "stores"("store_code");

-- CreateIndex
CREATE UNIQUE INDEX "stores_organization_id_slug_key" ON "stores"("organization_id", "slug");

-- AddForeignKey
ALTER TABLE "organization_users" ADD CONSTRAINT "organization_users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_users" ADD CONSTRAINT "organization_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_users" ADD CONSTRAINT "organization_users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_staff" ADD CONSTRAINT "store_staff_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_staff" ADD CONSTRAINT "store_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_staff" ADD CONSTRAINT "store_staff_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_manager_user_id_fkey" FOREIGN KEY ("manager_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
