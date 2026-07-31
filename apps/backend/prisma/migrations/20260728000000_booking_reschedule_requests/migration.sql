-- ============================================================================
-- Vendix — booking reschedule approval flow (phase 2)
-- ----------------------------------------------------------------------------
-- Adds:
--   * enum booking_reschedule_request_status_enum { pending | approved |
--     rejected | cancelled }
--   * enum values added to notification_type_enum:
--     - booking_reschedule_requested
--     - booking_reschedule_approved
--     - booking_reschedule_rejected
--     - booking_reschedule_cancelled
--   * table booking_reschedule_requests (pending reschedules when
--     store_settings.settings.reservations.allow_direct_reschedule = false)
--
-- Idempotent: every statement uses IF NOT EXISTS / EXCEPTION guards so the
-- migration can be re-run on a partially-applied DB (P3009 recovery from
-- skill `vendix-prisma-migrations`).
--
-- No destructive ops. The new table starts empty — historical bookings are
-- unaffected because the feature is gated by a per-store setting that
-- defaults to `true` (legacy direct-reschedule UX).
-- ============================================================================

-- 1. New status enum --------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'booking_reschedule_request_status_enum'
  ) THEN
    CREATE TYPE "booking_reschedule_request_status_enum" AS ENUM (
      'pending',
      'approved',
      'rejected',
      'cancelled'
    );
  END IF;
END $$;

-- 2. Extend notification_type_enum with the 4 new event keys ---------------
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, but each
-- individual IF NOT EXISTS is fine. We use DO blocks per value to keep the
-- migration re-runnable.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'booking_reschedule_requested'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'notification_type_enum')
  ) THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'booking_reschedule_requested';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'booking_reschedule_approved'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'notification_type_enum')
  ) THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'booking_reschedule_approved';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'booking_reschedule_rejected'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'notification_type_enum')
  ) THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'booking_reschedule_rejected';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'booking_reschedule_cancelled'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'notification_type_enum')
  ) THEN
    ALTER TYPE "notification_type_enum" ADD VALUE 'booking_reschedule_cancelled';
  END IF;
END $$;

-- 3. New table -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "booking_reschedule_requests" (
  "id"                       SERIAL PRIMARY KEY,
  "store_id"                 INTEGER NOT NULL,
  "booking_id"               INTEGER NOT NULL,
  "requested_date"           DATE NOT NULL,
  "requested_start_time"     VARCHAR(5) NOT NULL,
  "requested_end_time"       VARCHAR(5) NOT NULL,
  "requested_by_user_id"     INTEGER,
  "requested_by_customer_id" INTEGER,
  "requested_at"             TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  "reason"                   TEXT,
  "status"                   "booking_reschedule_request_status_enum" NOT NULL DEFAULT 'pending',
  "decided_by_user_id"       INTEGER,
  "decided_at"               TIMESTAMP(6),
  "decision_reason"          TEXT,
  "created_at"               TIMESTAMP(6) DEFAULT NOW(),
  "updated_at"               TIMESTAMP(6) DEFAULT NOW()
);

-- 4. FKs (idempotent via pg_constraint lookup) ------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_reschedule_requests_booking_id_fkey'
  ) THEN
    ALTER TABLE "booking_reschedule_requests"
      ADD CONSTRAINT "booking_reschedule_requests_booking_id_fkey"
      FOREIGN KEY ("booking_id") REFERENCES "bookings"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_reschedule_requests_store_id_fkey'
  ) THEN
    ALTER TABLE "booking_reschedule_requests"
      ADD CONSTRAINT "booking_reschedule_requests_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_reschedule_requests_requested_by_user_id_fkey'
  ) THEN
    ALTER TABLE "booking_reschedule_requests"
      ADD CONSTRAINT "booking_reschedule_requests_requested_by_user_id_fkey"
      FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_reschedule_requests_requested_by_customer_id_fkey'
  ) THEN
    ALTER TABLE "booking_reschedule_requests"
      ADD CONSTRAINT "booking_reschedule_requests_requested_by_customer_id_fkey"
      FOREIGN KEY ("requested_by_customer_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_reschedule_requests_decided_by_user_id_fkey'
  ) THEN
    ALTER TABLE "booking_reschedule_requests"
      ADD CONSTRAINT "booking_reschedule_requests_decided_by_user_id_fkey"
      FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- 5. Indexes for the admin queue and the per-booking lookup ---------------
CREATE INDEX IF NOT EXISTS "booking_reschedule_requests_booking_id_idx"
  ON "booking_reschedule_requests" ("booking_id");

CREATE INDEX IF NOT EXISTS "booking_reschedule_requests_store_id_status_idx"
  ON "booking_reschedule_requests" ("store_id", "status");

CREATE INDEX IF NOT EXISTS "booking_reschedule_requests_store_id_status_requested_at_idx"
  ON "booking_reschedule_requests" ("store_id", "status", "requested_at");