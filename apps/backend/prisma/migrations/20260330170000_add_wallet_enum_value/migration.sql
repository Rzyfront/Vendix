-- AlterEnum: Add wallet to payment_methods_type_enum (idempotent)
ALTER TYPE "payment_methods_type_enum" ADD VALUE IF NOT EXISTS 'wallet';
