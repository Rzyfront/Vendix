/*
  Warnings:

  - Added the required column `store_id` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "store_id" INTEGER NOT NULL;
