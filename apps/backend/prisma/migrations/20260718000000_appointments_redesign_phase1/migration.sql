-- ============================================================================
-- Vendix — Reservations Redesign Phase 1
-- ----------------------------------------------------------------------------
-- Adds:
--   * booking_status_enum values 'arriving' and 'attending'
--   * notification_type_enum values 'appointment_upcoming',
--     'appointment_checked_in', 'appointment_queued', 'appointment_no_show'
--   * bookings columns: arrival_at, queue_position, priority
--   * model store_business_hours (per-store DOW + HH:mm master calendar)
--   * model proximity_notification_log (dedup for proximity notifications)
--   * supporting indexes for the queue + check-in hot paths
--
-- Idempotent: every statement uses an IF NOT EXISTS / EXCEPTION guard so the
-- migration is safe to re-run on partially-applied databases (P3009 recovery
-- workflow from skill `vendix-prisma-migrations`).
--
-- Approval: feature/appointments-redesign · phase 1 backend.
-- No destructive ops. No data backfill (new columns are nullable or have
-- defaults so existing rows survive untouched).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend booking_status_enum with the appointment redesign states.
--    MUST run before any column default references the new values.
-- ---------------------------------------------------------------------------
ALTER TYPE "booking_status_enum" ADD VALUE IF NOT EXISTS 'arriving';
ALTER TYPE "booking_status_enum" ADD VALUE IF NOT EXISTS 'attending';

-- ---------------------------------------------------------------------------
-- 2. Extend notification_type_enum with the appointment_* notification types.
-- ---------------------------------------------------------------------------
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'appointment_upcoming';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'appointment_checked_in';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'appointment_queued';
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'appointment_no_show';

-- ---------------------------------------------------------------------------
-- 3. New columns on bookings. Nullable + defaulted so existing rows survive.
-- ---------------------------------------------------------------------------
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "arrival_at" TIMESTAMP(6);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "queue_position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 4. Supporting indexes for queue + check-in hot paths.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "bookings_store_id_date_idx"
  ON "bookings" ("store_id", "date");

-- Partial index for the live queue query: rows that have actually arrived.
-- Keeps the index small even on stores with millions of historical bookings.
CREATE INDEX IF NOT EXISTS "bookings_store_id_status_arrival_at_idx"
  ON "bookings" ("store_id", "status", "arrival_at")
  WHERE "arrival_at" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. store_business_hours — per-store master calendar (DOW + HH:mm).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "store_business_hours" (
  "id"          SERIAL PRIMARY KEY,
  "store_id"    INTEGER NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "day_of_week" INTEGER NOT NULL,
  "start_time"  VARCHAR(5) NOT NULL,
  "end_time"    VARCHAR(5) NOT NULL,
  "is_active"   BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at"  TIMESTAMP(6) DEFAULT NOW(),
  "updated_at"  TIMESTAMP(6) DEFAULT NOW()
);

DO $$ BEGIN
  -- Drop the index if it exists (created by a previous partial apply)
  -- before adding the UNIQUE constraint (which auto-creates an index with the same name).
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'store_business_hours_store_id_day_of_week_key'
      AND tablename = 'store_business_hours'
  ) THEN
    DROP INDEX IF EXISTS "store_business_hours_store_id_day_of_week_key";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'store_business_hours_store_id_day_of_week_key'
      AND table_name = 'store_business_hours'
  ) THEN
    ALTER TABLE "store_business_hours"
      ADD CONSTRAINT "store_business_hours_store_id_day_of_week_key"
      UNIQUE ("store_id", "day_of_week");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "store_business_hours_store_id_idx"
  ON "store_business_hours" ("store_id");

-- ---------------------------------------------------------------------------
-- 6. proximity_notification_log — dedup log for appointment_upcoming.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "proximity_notification_log" (
  "id"                SERIAL PRIMARY KEY,
  "booking_id"        INTEGER NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "proximity_minutes" INTEGER NOT NULL,
  "channel"           VARCHAR(32) NOT NULL,
  "sent_at"           TIMESTAMP(6) NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'proximity_notification_log_booking_id_proximity_minutes_channel_key'
      AND table_name = 'proximity_notification_log'
  ) THEN
    ALTER TABLE "proximity_notification_log"
      ADD CONSTRAINT "proximity_notification_log_booking_id_proximity_minutes_channel_key"
      UNIQUE ("booking_id", "proximity_minutes", "channel");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "proximity_notification_log_booking_id_idx"
  ON "proximity_notification_log" ("booking_id");
