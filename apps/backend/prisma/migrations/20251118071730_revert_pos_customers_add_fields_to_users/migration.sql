/*
  Warnings:

  - You are about to drop the `pos_customers` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "document_number" VARCHAR(50),
ADD COLUMN     "document_type" VARCHAR(50);

-- DropTable
DROP TABLE "pos_customers";

-- CreateIndex
CREATE INDEX "users_document_number_idx" ON "users"("document_number");
