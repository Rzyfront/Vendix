-- AlterTable
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(6);
