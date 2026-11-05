-- Estaciones fase 2 (S1, S8, S9, S12, S17, S21): reglas de anticipo por estación,
-- copia de las reglas en la atención, reservas que cruzan la medianoche y tipo de
-- línea de la atención.
--
-- DATA IMPACT:
-- Tables affected: service_stations, service_sessions, bookings, order_items (schema only)
-- Expected row changes: none (new nullable columns or columns with a constant default)
-- Destructive operations: none
-- FK/cascade risk: new FK service_stations.reservation_fee_tax_category_id -> tax_categories ON DELETE RESTRICT
-- Idempotency: guarded enums (pg_type), ADD COLUMN IF NOT EXISTS, guarded constraint (pg_constraint)
-- Approval: plan approved in chat (L9 "Ejecuta!"), additive only

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'station_deposit_policy_enum') THEN
    CREATE TYPE "station_deposit_policy_enum" AS ENUM ('none', 'optional', 'required');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'station_deposit_exhausted_enum') THEN
    CREATE TYPE "station_deposit_exhausted_enum" AS ENUM ('recharge', 'overflow');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'station_leftover_policy_enum') THEN
    CREATE TYPE "station_leftover_policy_enum" AS ENUM ('refund_or_credit', 'minimum_spend');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'station_booking_duration_enum') THEN
    CREATE TYPE "station_booking_duration_enum" AS ENUM ('fixed', 'free');
  END IF;
END $$;

ALTER TABLE "service_stations"
  ADD COLUMN IF NOT EXISTS "deposit_policy" "station_deposit_policy_enum" NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "deposit_amount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "deposit_exhausted_policy" "station_deposit_exhausted_enum" NOT NULL DEFAULT 'overflow',
  ADD COLUMN IF NOT EXISTS "leftover_policy" "station_leftover_policy_enum" NOT NULL DEFAULT 'refund_or_credit',
  ADD COLUMN IF NOT EXISTS "hold_minutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "open_end_block_minutes" INTEGER NOT NULL DEFAULT 360,
  ADD COLUMN IF NOT EXISTS "cancel_refund_hours" INTEGER,
  ADD COLUMN IF NOT EXISTS "booking_duration_mode" "station_booking_duration_enum" NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS "reservation_fee_tax_category_id" INTEGER;

CREATE INDEX IF NOT EXISTS "service_stations_reservation_fee_tax_category_id_idx"
  ON "service_stations"("reservation_fee_tax_category_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_stations_reservation_fee_tax_category_id_fkey') THEN
    ALTER TABLE "service_stations" ADD CONSTRAINT "service_stations_reservation_fee_tax_category_id_fkey"
      FOREIGN KEY ("reservation_fee_tax_category_id") REFERENCES "tax_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

ALTER TABLE "service_sessions"
  ADD COLUMN IF NOT EXISTS "deposit_policy" "station_deposit_policy_enum",
  ADD COLUMN IF NOT EXISTS "deposit_required_amount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "deposit_exhausted_policy" "station_deposit_exhausted_enum",
  ADD COLUMN IF NOT EXISTS "leftover_policy" "station_leftover_policy_enum",
  ADD COLUMN IF NOT EXISTS "settled_at" TIMESTAMPTZ(6);

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "end_date" DATE,
  ADD COLUMN IF NOT EXISTS "is_open_ended" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "deposit_decision_due_at" TIMESTAMPTZ(6);

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "service_line_kind" VARCHAR(24);
