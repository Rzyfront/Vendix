-- Migration: Add pqr_new and pqr_update notification type values
--
-- Idempotent enum value additions for the PQR in-app notification bell.
-- These values are emitted by `pqr-notifications.listener.ts` (handling
-- pqr.created and pqr.response_sent events) but were never declared in
-- the enum, causing `notifications.createMany` to silently fail inside
-- the listener's try/catch.
--
-- Pattern: DO $$ ... pg_enum guard so the migration is safe to re-apply
-- if a previous run partially succeeded.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'pqr_new') THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'pqr_new';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'pqr_update') THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'pqr_update';
  END IF;
END
$$;