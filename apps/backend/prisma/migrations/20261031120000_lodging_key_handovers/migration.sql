-- DATA IMPACT:
-- Tables affected: new table lodging_key_handovers (key / access card
--   handover log of a hotel reservation: delivery and return).
-- Expected row changes: none. Existing tables are not modified.
-- Destructive operations: none.
-- FK/cascade risk: none. store/reservation FKs are ON DELETE RESTRICT; room
--   and staff user FKs are ON DELETE SET NULL (no cascade).
-- Idempotency: CREATE TABLE / INDEX IF NOT EXISTS, FKs guarded by pg_constraint.
-- Approval: hospitality plan, slice H8.4 replaced by owner decision D12.

CREATE TABLE IF NOT EXISTS "lodging_key_handovers" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "reservation_id" INTEGER NOT NULL,
    "reservation_room_id" INTEGER,
    "key_label" VARCHAR(60) NOT NULL,
    "guest_name" VARCHAR(150) NOT NULL,
    "notes" VARCHAR(300),
    "delivered_by_user_id" INTEGER,
    "delivered_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returned_by_user_id" INTEGER,
    "returned_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_key_handovers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lodging_key_handovers_reservation_id_idx"
  ON "lodging_key_handovers"("reservation_id");

CREATE INDEX IF NOT EXISTS "lodging_key_handovers_store_id_returned_at_idx"
  ON "lodging_key_handovers"("store_id", "returned_at");

-- A key is with one guest at a time (not expressible in Prisma).
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_key_handovers_open_key_label_key"
  ON "lodging_key_handovers"("store_id", lower("key_label"))
  WHERE "returned_at" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_key_handovers_store_id_fkey') THEN
    ALTER TABLE "lodging_key_handovers"
      ADD CONSTRAINT "lodging_key_handovers_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_key_handovers_reservation_id_fkey') THEN
    ALTER TABLE "lodging_key_handovers"
      ADD CONSTRAINT "lodging_key_handovers_reservation_id_fkey"
      FOREIGN KEY ("reservation_id") REFERENCES "lodging_reservations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_key_handovers_reservation_room_id_fkey') THEN
    ALTER TABLE "lodging_key_handovers"
      ADD CONSTRAINT "lodging_key_handovers_reservation_room_id_fkey"
      FOREIGN KEY ("reservation_room_id") REFERENCES "lodging_reservation_rooms"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_key_handovers_delivered_by_user_id_fkey') THEN
    ALTER TABLE "lodging_key_handovers"
      ADD CONSTRAINT "lodging_key_handovers_delivered_by_user_id_fkey"
      FOREIGN KEY ("delivered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_key_handovers_returned_by_user_id_fkey') THEN
    ALTER TABLE "lodging_key_handovers"
      ADD CONSTRAINT "lodging_key_handovers_returned_by_user_id_fkey"
      FOREIGN KEY ("returned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END
$$;
