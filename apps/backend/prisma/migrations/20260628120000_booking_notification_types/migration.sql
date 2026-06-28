-- Migration: Add missing + new booking notification types
--
-- Idempotent enum value additions. PostgreSQL `ALTER TYPE ... ADD VALUE`
-- runs OUTSIDE transactions, so we wrap each addition in a guard to make
-- this migration safe to re-apply if it partially succeeded.
--
-- Two groups of values:
--   1. Backfill: types that `notifications-events.listener.ts` already emits
--      but were never declared in the enum, causing `notifications.create`
--      to silently fail inside the createAndBroadcast try/catch.
--   2. New: types introduced by the bookings availability & arrival-alerts
--      feature (booking_arrival, booking_attending).

DO $$
BEGIN
  -- ===== Backfill: types already used by existing listeners =====
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'booking_created') THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'booking_created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'booking_confirmed') THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'booking_confirmed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'booking_cancelled') THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'booking_cancelled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'booking_no_show') THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'booking_no_show';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'booking_reminder') THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'booking_reminder';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'booking_rescheduled') THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'booking_rescheduled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'booking_started') THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'booking_started';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'booking_completed') THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'booking_completed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'invoice_data_request_submitted') THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'invoice_data_request_submitted';
  END IF;

  -- ===== New: bookings availability & arrival-alerts feature =====
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'booking_arrival') THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'booking_arrival';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'notification_type_enum' AND e.enumlabel = 'booking_attending') THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'booking_attending';
  END IF;
END
$$;