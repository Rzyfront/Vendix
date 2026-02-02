/*
  Warnings:

  - You are about to drop the column `config` on the `organization_settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "organization_settings" DROP COLUMN "config",
ADD COLUMN     "settings" JSONB;
