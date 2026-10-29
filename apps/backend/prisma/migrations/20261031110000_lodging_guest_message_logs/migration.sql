-- DATA IMPACT:
-- Tables affected: new table lodging_guest_message_logs (log of automatic
--   guest emails of a hotel reservation).
-- Expected row changes: none. Existing tables are not modified.
-- Destructive operations: none.
-- FK/cascade risk: none. Both FKs are ON DELETE RESTRICT (no cascade).
-- Idempotency: CREATE TABLE / INDEX IF NOT EXISTS, FKs guarded by pg_constraint.
-- Approval: hospitality plan, slice H8.2 (pre and post stay emails).

CREATE TABLE IF NOT EXISTS "lodging_guest_message_logs" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "reservation_id" INTEGER NOT NULL,
    "message_key" VARCHAR(30) NOT NULL,
    "channel" VARCHAR(20) NOT NULL DEFAULT 'email',
    "sent_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_guest_message_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_guest_message_logs_reservation_id_message_key_channel_key"
  ON "lodging_guest_message_logs"("reservation_id", "message_key", "channel");

CREATE INDEX IF NOT EXISTS "lodging_guest_message_logs_store_id_sent_at_idx"
  ON "lodging_guest_message_logs"("store_id", "sent_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_guest_message_logs_store_id_fkey') THEN
    ALTER TABLE "lodging_guest_message_logs"
      ADD CONSTRAINT "lodging_guest_message_logs_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_guest_message_logs_reservation_id_fkey') THEN
    ALTER TABLE "lodging_guest_message_logs"
      ADD CONSTRAINT "lodging_guest_message_logs_reservation_id_fkey"
      FOREIGN KEY ("reservation_id") REFERENCES "lodging_reservations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END
$$;
