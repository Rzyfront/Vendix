-- AlterEnum: Add wallet to payment_methods_type_enum
ALTER TYPE "payment_methods_type_enum" ADD VALUE 'wallet';

-- Update existing wallet system_payment_method from voucher to wallet
UPDATE "system_payment_methods" SET "type" = 'wallet' WHERE "name" = 'wallet' AND "type" = 'voucher';
