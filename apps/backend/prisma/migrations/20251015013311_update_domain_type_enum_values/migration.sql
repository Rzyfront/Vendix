/*
  Warnings:

  - The values [organization_root,organization_subdomain,store_subdomain,store_custom] on the enum `domain_type_enum` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "public"."domain_type_enum_new" AS ENUM ('vendix_core', 'organization', 'store', 'ecommerce');
ALTER TABLE "public"."domain_settings" ALTER COLUMN "domain_type" DROP DEFAULT;
ALTER TABLE "public"."domain_settings" ALTER COLUMN "domain_type" TYPE "public"."domain_type_enum_new" USING ("domain_type"::text::"public"."domain_type_enum_new");
ALTER TYPE "public"."domain_type_enum" RENAME TO "domain_type_enum_old";
ALTER TYPE "public"."domain_type_enum_new" RENAME TO "domain_type_enum";
DROP TYPE "public"."domain_type_enum_old";
ALTER TABLE "public"."domain_settings" ALTER COLUMN "domain_type" SET DEFAULT 'organization';
COMMIT;

-- AlterTable
ALTER TABLE "public"."domain_settings" ALTER COLUMN "domain_type" SET DEFAULT 'organization';
