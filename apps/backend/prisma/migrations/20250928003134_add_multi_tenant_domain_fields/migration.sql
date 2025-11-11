/*
  Warnings:

  - A unique constraint covering the columns `[verification_token]` on the table `domain_settings` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "public"."domain_type_enum" AS ENUM ('vendix_core', 'organization_root', 'organization_subdomain', 'store_subdomain', 'store_custom');

-- CreateEnum
CREATE TYPE "public"."domain_status_enum" AS ENUM ('pending_dns', 'pending_ssl', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "public"."ssl_status_enum" AS ENUM ('none', 'pending', 'issued', 'error', 'revoked');

-- AlterTable
ALTER TABLE "public"."domain_settings" ADD COLUMN     "domain_type" "public"."domain_type_enum" NOT NULL DEFAULT 'organization_root',
ADD COLUMN     "is_primary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_error" VARCHAR(255),
ADD COLUMN     "last_verified_at" TIMESTAMP(6),
ADD COLUMN     "ssl_status" "public"."ssl_status_enum" NOT NULL DEFAULT 'none',
ADD COLUMN     "status" "public"."domain_status_enum" NOT NULL DEFAULT 'active',
ADD COLUMN     "verification_token" VARCHAR(100);

-- CreateIndex
CREATE UNIQUE INDEX "domain_settings_verification_token_key" ON "public"."domain_settings"("verification_token");

-- CreateIndex
CREATE INDEX "domain_settings_organization_id_idx" ON "public"."domain_settings"("organization_id");

-- CreateIndex
CREATE INDEX "domain_settings_store_id_idx" ON "public"."domain_settings"("store_id");

-- CreateIndex
CREATE INDEX "domain_settings_status_idx" ON "public"."domain_settings"("status");

-- CreateIndex
CREATE INDEX "domain_settings_domain_type_idx" ON "public"."domain_settings"("domain_type");
