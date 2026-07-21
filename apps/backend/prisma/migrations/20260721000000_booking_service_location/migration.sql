-- ============================================================================
-- Vendix — booking service_location feature (phase 1)
-- ----------------------------------------------------------------------------
-- Adds:
--   * booking_service_location_enum { home | shop }
--   * bookings.service_location_type (NOT NULL, default 'shop' for historical
--     bookings)
--   * bookings.service_address_id (nullable FK to addresses) — only set
--     when service_location_type = 'home'
--
-- Idempotent: every statement uses an IF NOT EXISTS / EXCEPTION guard so
-- the migration can be re-run on a partially-applied DB (P3009 recovery
-- workflow from skill `vendix-prisma-migrations`).
--
-- No destructive ops. No data backfill required: existing bookings get
-- the default 'shop' value automatically.
-- ============================================================================

-- 1. New enum ----------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'booking_service_location_enum'
  ) THEN
    CREATE TYPE "booking_service_location_enum" AS ENUM ('home', 'shop');
  END IF;
END $$;

-- 2. bookings.service_location_type ------------------------------------------
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "service_location_type"
    "booking_service_location_enum" NOT NULL DEFAULT 'shop';

-- 3. bookings.service_address_id --------------------------------------------
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "service_address_id" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_service_address_id_fkey'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "bookings_service_address_id_fkey"
      FOREIGN KEY ("service_address_id")
      REFERENCES "addresses"("id")
      ON DELETE SET NULL
      ON UPDATE NO ACTION;
  END IF;
END $$;

-- 4. Index for the FK (fast lookups when joining the address) ---------------
CREATE INDEX IF NOT EXISTS "bookings_service_address_id_idx"
  ON "bookings" ("service_address_id");
