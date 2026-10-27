-- DATA IMPACT:
-- Tables affected: none existing. Creates lodging_reservation_events (empty),
-- the status history of hotel reservations.
-- Expected row changes: none.
-- Destructive operations: none.
-- FK/cascade risk: none. New FKs use ON DELETE RESTRICT (SET NULL for the user).
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS and guarded constraints.
-- Approval: hospitality plan, slice H1.2 (owner decisions 2026-10-26).

CREATE TABLE IF NOT EXISTS "lodging_reservation_events" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "reservation_id" INTEGER NOT NULL,
    "from_status" "lodging_reservation_status_enum",
    "to_status" "lodging_reservation_status_enum" NOT NULL,
    "reason" VARCHAR(500),
    "user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_reservation_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lodging_reservation_events_reservation_id_idx"
  ON "lodging_reservation_events"("reservation_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_reservation_events_store_id_fkey') THEN
    ALTER TABLE "lodging_reservation_events" ADD CONSTRAINT "lodging_reservation_events_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_reservation_events_reservation_id_fkey') THEN
    ALTER TABLE "lodging_reservation_events" ADD CONSTRAINT "lodging_reservation_events_reservation_id_fkey"
      FOREIGN KEY ("reservation_id") REFERENCES "lodging_reservations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_reservation_events_user_id_fkey') THEN
    ALTER TABLE "lodging_reservation_events" ADD CONSTRAINT "lodging_reservation_events_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
