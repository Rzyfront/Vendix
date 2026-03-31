-- AlterEnum: Add wompi to payment_methods_type_enum
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction in PostgreSQL.
-- Prisma handles this automatically with the executeRaw approach.
ALTER TYPE "payment_methods_type_enum" ADD VALUE 'wompi';
