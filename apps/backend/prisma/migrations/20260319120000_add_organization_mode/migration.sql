-- CreateEnum
CREATE TYPE "organization_mode_enum" AS ENUM ('production', 'demo', 'test');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "mode" "organization_mode_enum" NOT NULL DEFAULT 'production';

-- CreateIndex
CREATE INDEX "organizations_mode_idx" ON "organizations"("mode");
