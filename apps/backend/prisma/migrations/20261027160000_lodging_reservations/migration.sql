-- DATA IMPACT:
-- Tables affected: none existing. Creates lodging_reservations,
-- lodging_reservation_rooms and lodging_room_nights (empty) and the enum
-- lodging_reservation_status_enum.
-- Expected row changes: none.
-- Destructive operations: none.
-- FK/cascade risk: none. New FKs use ON DELETE RESTRICT (SET NULL for the
-- optional physical room and the creator user).
-- Idempotency: guarded CREATE TYPE, CREATE TABLE/INDEX IF NOT EXISTS and guarded constraints.
-- Approval: hospitality plan, slice H1.1 (owner decisions 2026-10-26).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lodging_reservation_status_enum') THEN
    CREATE TYPE "lodging_reservation_status_enum" AS ENUM ('tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "lodging_reservations" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "reservation_number" VARCHAR(20) NOT NULL,
    "status" "lodging_reservation_status_enum" NOT NULL DEFAULT 'confirmed',
    "arrival_date" DATE NOT NULL,
    "departure_date" DATE NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_reservations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lodging_reservation_rooms" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "reservation_id" INTEGER NOT NULL,
    "unit_type_id" INTEGER NOT NULL,
    "unit_id" INTEGER,
    "arrival_date" DATE NOT NULL,
    "departure_date" DATE NOT NULL,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_reservation_rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lodging_room_nights" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "reservation_room_id" INTEGER NOT NULL,
    "unit_type_id" INTEGER NOT NULL,
    "unit_id" INTEGER,
    "night_date" DATE NOT NULL,
    "rate_amount" DECIMAL(14,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_room_nights_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_reservations_store_id_reservation_number_key" ON "lodging_reservations"("store_id", "reservation_number");
CREATE INDEX IF NOT EXISTS "lodging_reservations_store_id_arrival_date_idx" ON "lodging_reservations"("store_id", "arrival_date");
CREATE INDEX IF NOT EXISTS "lodging_reservations_customer_id_idx" ON "lodging_reservations"("customer_id");
CREATE INDEX IF NOT EXISTS "lodging_reservation_rooms_reservation_id_idx" ON "lodging_reservation_rooms"("reservation_id");
CREATE INDEX IF NOT EXISTS "lodging_reservation_rooms_unit_type_id_idx" ON "lodging_reservation_rooms"("unit_type_id");
CREATE INDEX IF NOT EXISTS "lodging_room_nights_unit_type_id_night_date_is_active_idx" ON "lodging_room_nights"("unit_type_id", "night_date", "is_active");
CREATE INDEX IF NOT EXISTS "lodging_room_nights_reservation_room_id_idx" ON "lodging_room_nights"("reservation_room_id");
-- A physical room cannot hold two active nights on the same date (not
-- expressible in Prisma; documented on the model).
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_room_nights_unit_id_night_date_active_key" ON "lodging_room_nights"("unit_id", "night_date") WHERE "unit_id" IS NOT NULL AND "is_active";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_reservations_store_id_fkey') THEN
    ALTER TABLE "lodging_reservations" ADD CONSTRAINT "lodging_reservations_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_reservations_customer_id_fkey') THEN
    ALTER TABLE "lodging_reservations" ADD CONSTRAINT "lodging_reservations_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_reservations_created_by_user_id_fkey') THEN
    ALTER TABLE "lodging_reservations" ADD CONSTRAINT "lodging_reservations_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_reservation_rooms_store_id_fkey') THEN
    ALTER TABLE "lodging_reservation_rooms" ADD CONSTRAINT "lodging_reservation_rooms_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_reservation_rooms_reservation_id_fkey') THEN
    ALTER TABLE "lodging_reservation_rooms" ADD CONSTRAINT "lodging_reservation_rooms_reservation_id_fkey"
      FOREIGN KEY ("reservation_id") REFERENCES "lodging_reservations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_reservation_rooms_unit_type_id_fkey') THEN
    ALTER TABLE "lodging_reservation_rooms" ADD CONSTRAINT "lodging_reservation_rooms_unit_type_id_fkey"
      FOREIGN KEY ("unit_type_id") REFERENCES "lodging_unit_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_reservation_rooms_unit_id_fkey') THEN
    ALTER TABLE "lodging_reservation_rooms" ADD CONSTRAINT "lodging_reservation_rooms_unit_id_fkey"
      FOREIGN KEY ("unit_id") REFERENCES "lodging_units"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_room_nights_store_id_fkey') THEN
    ALTER TABLE "lodging_room_nights" ADD CONSTRAINT "lodging_room_nights_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_room_nights_reservation_room_id_fkey') THEN
    ALTER TABLE "lodging_room_nights" ADD CONSTRAINT "lodging_room_nights_reservation_room_id_fkey"
      FOREIGN KEY ("reservation_room_id") REFERENCES "lodging_reservation_rooms"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_room_nights_unit_type_id_fkey') THEN
    ALTER TABLE "lodging_room_nights" ADD CONSTRAINT "lodging_room_nights_unit_type_id_fkey"
      FOREIGN KEY ("unit_type_id") REFERENCES "lodging_unit_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_room_nights_unit_id_fkey') THEN
    ALTER TABLE "lodging_room_nights" ADD CONSTRAINT "lodging_room_nights_unit_id_fkey"
      FOREIGN KEY ("unit_id") REFERENCES "lodging_units"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
