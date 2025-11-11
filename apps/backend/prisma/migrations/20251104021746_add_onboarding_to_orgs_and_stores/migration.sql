/*
  Warnings:

  - You are about to drop the column `onboarding_completed` on the `users` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."users_onboarding_completed_idx";

-- AlterTable
ALTER TABLE "public"."organizations" ADD COLUMN     "onboarding" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."stores" ADD COLUMN     "onboarding" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."users" DROP COLUMN "onboarding_completed";

-- CreateIndex
CREATE INDEX "organizations_onboarding_idx" ON "public"."organizations"("onboarding");

-- CreateIndex
CREATE INDEX "stores_onboarding_idx" ON "public"."stores"("onboarding");
