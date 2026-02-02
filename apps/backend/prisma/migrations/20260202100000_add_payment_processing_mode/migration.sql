-- CreateEnum
CREATE TYPE "payment_processing_mode_enum" AS ENUM ('DIRECT', 'ONLINE', 'ON_DELIVERY');

-- AlterTable
ALTER TABLE "system_payment_methods" ADD COLUMN "processing_mode" "payment_processing_mode_enum" NOT NULL DEFAULT 'ONLINE';

-- Update existing methods with appropriate processing_mode
UPDATE "system_payment_methods" SET "processing_mode" = 'DIRECT' WHERE "name" = 'cash';
-- stripe_card, paypal, bank_transfer, payment_vouchers remain ONLINE (the default)
