-- DATA IMPACT:
-- Tables affected: creates lodging_guests (empty).
-- Expected row changes: none. No existing table or row is modified.
-- Destructive operations: none.
-- FK/cascade risk: none. New FKs use ON DELETE RESTRICT or SET NULL.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS and guarded constraints.
-- Approval: hospitality plan, slice H3.1 (owner decisions 2026-10-26).

-- Guest register of a reservation: holder and companions by room, with the
-- TRA (Res. 409/2022 art. 7) and SIRE fields. No document photo (Ley 1581).
CREATE TABLE IF NOT EXISTS "lodging_guests" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "reservation_id" INTEGER NOT NULL,
    "reservation_room_id" INTEGER,
    "customer_id" INTEGER,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "document_type" "identification_type_enum" NOT NULL,
    "document_number" VARCHAR(50) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "nationality_country_code" CHAR(2) NOT NULL,
    "birth_date" DATE,
    "residence_city" VARCHAR(120) NOT NULL,
    "origin_city" VARCHAR(120) NOT NULL,
    "travel_purpose" VARCHAR(40) NOT NULL,
    "entry_permit_type" VARCHAR(20),
    "is_non_resident" BOOLEAN NOT NULL DEFAULT false,
    "data_consent_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_guests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_guests_reservation_id_document_type_document_number_key" ON "lodging_guests"("reservation_id", "document_type", "document_number");
CREATE INDEX IF NOT EXISTS "lodging_guests_store_id_idx" ON "lodging_guests"("store_id");
CREATE INDEX IF NOT EXISTS "lodging_guests_reservation_room_id_idx" ON "lodging_guests"("reservation_room_id");
CREATE INDEX IF NOT EXISTS "lodging_guests_customer_id_idx" ON "lodging_guests"("customer_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_guests_store_id_fkey') THEN
    ALTER TABLE "lodging_guests" ADD CONSTRAINT "lodging_guests_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_guests_reservation_id_fkey') THEN
    ALTER TABLE "lodging_guests" ADD CONSTRAINT "lodging_guests_reservation_id_fkey"
      FOREIGN KEY ("reservation_id") REFERENCES "lodging_reservations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_guests_reservation_room_id_fkey') THEN
    ALTER TABLE "lodging_guests" ADD CONSTRAINT "lodging_guests_reservation_room_id_fkey"
      FOREIGN KEY ("reservation_room_id") REFERENCES "lodging_reservation_rooms"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_guests_customer_id_fkey') THEN
    ALTER TABLE "lodging_guests" ADD CONSTRAINT "lodging_guests_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
