-- AlterEnum
-- Adds PQR (Petición / Queja / Reclamo) categories to the ticket category enum.
-- Idempotent because the values were first applied manually on 2026-06-22
-- via add_pqr_ticket_categories.sql; this migration now standardizes them
-- under the Prisma migrate framework so future deploys track the schema.
ALTER TYPE "ticket_category_enum" ADD VALUE IF NOT EXISTS 'PETITION';
ALTER TYPE "ticket_category_enum" ADD VALUE IF NOT EXISTS 'COMPLAINT';
ALTER TYPE "ticket_category_enum" ADD VALUE IF NOT EXISTS 'CLAIM';
