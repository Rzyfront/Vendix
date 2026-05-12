-- DATA IMPACT:
-- Tables affected: none (enum-only)
-- Action: ADD values 'pending', 'approved', 'received' to transfer_status_enum.
-- Expected row changes: NONE. This migration only extends the enum type. Backfill of rows
--   from legacy values (draft -> pending/approved, completed -> received) happens in the
--   companion migration `20260509002648_transfer_lifecycle_columns` AFTER this one commits.
-- Destructive operations: NONE. Legacy values 'draft' and 'completed' are NOT removed
--   (deferred to a later release per Plan §13#2).
-- FK/cascade risk: none.
-- Idempotency: ALTER TYPE ... ADD VALUE IF NOT EXISTS (Postgres 12+).
-- Approval: documented in plan P4.1 and chat.
--
-- IMPORTANT: This migration is split from the column-and-backfill migration because Postgres
-- forbids using a newly-added enum value in the same transaction. Each Prisma migration runs
-- in its own transaction, so ADD VALUE must commit before any UPDATE references the new value.

ALTER TYPE "transfer_status_enum" ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE "transfer_status_enum" ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE "transfer_status_enum" ADD VALUE IF NOT EXISTS 'received';
