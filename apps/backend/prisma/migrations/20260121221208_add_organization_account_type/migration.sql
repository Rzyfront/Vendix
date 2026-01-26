-- CreateEnum
CREATE TYPE "organization_account_type_enum" AS ENUM ('SINGLE_STORE', 'MULTI_STORE_ORG');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "account_type" "organization_account_type_enum" NOT NULL DEFAULT 'SINGLE_STORE';

-- CreateIndex
CREATE INDEX "organizations_account_type_idx" ON "organizations"("account_type");
