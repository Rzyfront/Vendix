/*
  Warnings:

  - You are about to drop the column `cache_ttl` on the `domain_settings` table. All the data in the column will be lost.
  - You are about to drop the column `domain_type` on the `domain_settings` table. All the data in the column will be lost.
  - You are about to drop the column `environment_config` on the `domain_settings` table. All the data in the column will be lost.
  - You are about to drop the column `force_https` on the `domain_settings` table. All the data in the column will be lost.
  - You are about to drop the column `is_active` on the `domain_settings` table. All the data in the column will be lost.
  - You are about to drop the column `last_checked` on the `domain_settings` table. All the data in the column will be lost.
  - You are about to drop the column `purpose` on the `domain_settings` table. All the data in the column will be lost.
  - You are about to drop the column `ssl_certificate` on the `domain_settings` table. All the data in the column will be lost.
  - You are about to drop the column `ssl_enabled` on the `domain_settings` table. All the data in the column will be lost.
  - You are about to drop the column `verified_at` on the `domain_settings` table. All the data in the column will be lost.
  - You are about to drop the `tenant_branding` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `tenant_features` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `tenant_seo` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `tenant_themes` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `organization_id` on table `domain_settings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `config` on table `domain_settings` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "tenant_branding" DROP CONSTRAINT "tenant_branding_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "tenant_branding" DROP CONSTRAINT "tenant_branding_store_id_fkey";

-- DropForeignKey
ALTER TABLE "tenant_features" DROP CONSTRAINT "tenant_features_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "tenant_features" DROP CONSTRAINT "tenant_features_store_id_fkey";

-- DropForeignKey
ALTER TABLE "tenant_seo" DROP CONSTRAINT "tenant_seo_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "tenant_seo" DROP CONSTRAINT "tenant_seo_store_id_fkey";

-- DropForeignKey
ALTER TABLE "tenant_themes" DROP CONSTRAINT "tenant_themes_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "tenant_themes" DROP CONSTRAINT "tenant_themes_store_id_fkey";

-- DropIndex
DROP INDEX "domain_settings_domain_type_purpose_idx";

-- DropIndex
DROP INDEX "domain_settings_is_active_idx";

-- DropIndex
DROP INDEX "domain_settings_organization_id_idx";

-- DropIndex
DROP INDEX "domain_settings_store_id_idx";

-- AlterTable
ALTER TABLE "domain_settings" DROP COLUMN "cache_ttl",
DROP COLUMN "domain_type",
DROP COLUMN "environment_config",
DROP COLUMN "force_https",
DROP COLUMN "is_active",
DROP COLUMN "last_checked",
DROP COLUMN "purpose",
DROP COLUMN "ssl_certificate",
DROP COLUMN "ssl_enabled",
DROP COLUMN "verified_at",
ALTER COLUMN "organization_id" SET NOT NULL,
ALTER COLUMN "config" SET NOT NULL;

-- DropTable
DROP TABLE "tenant_branding";

-- DropTable
DROP TABLE "tenant_features";

-- DropTable
DROP TABLE "tenant_seo";

-- DropTable
DROP TABLE "tenant_themes";

-- DropEnum
DROP TYPE "domain_purpose_enum";

-- DropEnum
DROP TYPE "domain_type_enum";

-- CreateTable
CREATE TABLE "organization_settings" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_settings_organization_id_key" ON "organization_settings"("organization_id");

-- AddForeignKey
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
