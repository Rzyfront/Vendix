-- CreateEnum
CREATE TYPE "public"."domain_ownership_enum" AS ENUM ('vendix_subdomain', 'custom_domain', 'custom_subdomain', 'vendix_core', 'third_party_subdomain');

-- AlterTable
ALTER TABLE "public"."domain_settings" ADD COLUMN     "ownership" "public"."domain_ownership_enum" NOT NULL DEFAULT 'vendix_subdomain';

-- CreateIndex
CREATE INDEX "domain_settings_ownership_idx" ON "public"."domain_settings"("ownership");
