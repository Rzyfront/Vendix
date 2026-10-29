-- DATA IMPACT:
-- Tables affected: new tables lodging_compliance_submissions (log of the TRA
--   report of each guest per check-in / check-out) and
--   lodging_compliance_credentials (encrypted TRA token per store).
-- Expected row changes: none. Existing tables are not modified.
-- Destructive operations: none.
-- FK/cascade risk: none. store/reservation FKs are ON DELETE RESTRICT; guest
--   and reporting user FKs are ON DELETE SET NULL (no cascade).
-- Idempotency: CREATE TABLE / INDEX IF NOT EXISTS, FKs guarded by pg_constraint.
-- Approval: hospitality plan, slice H4.1.

CREATE TABLE IF NOT EXISTS "lodging_compliance_submissions" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "reservation_id" INTEGER NOT NULL,
    "guest_id" INTEGER,
    "authority" VARCHAR(10) NOT NULL,
    "event" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "guest_name" VARCHAR(200) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(40),
    "last_error" VARCHAR(300),
    "payload" JSONB,
    "response" JSONB,
    "sent_at" TIMESTAMP(6),
    "reported_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_compliance_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_compliance_submissions_guest_id_authority_event_key"
  ON "lodging_compliance_submissions"("guest_id", "authority", "event");

CREATE INDEX IF NOT EXISTS "lodging_compliance_submissions_store_id_authority_status_idx"
  ON "lodging_compliance_submissions"("store_id", "authority", "status");

CREATE INDEX IF NOT EXISTS "lodging_compliance_submissions_reservation_id_idx"
  ON "lodging_compliance_submissions"("reservation_id");

CREATE TABLE IF NOT EXISTS "lodging_compliance_credentials" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "authority" VARCHAR(10) NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "secret_hint" VARCHAR(8) NOT NULL,
    "tested_at" TIMESTAMP(6),
    "test_ok" BOOLEAN,
    "test_message" VARCHAR(300),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_compliance_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_compliance_credentials_store_id_authority_key"
  ON "lodging_compliance_credentials"("store_id", "authority");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_compliance_submissions_store_id_fkey') THEN
    ALTER TABLE "lodging_compliance_submissions"
      ADD CONSTRAINT "lodging_compliance_submissions_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_compliance_submissions_reservation_id_fkey') THEN
    ALTER TABLE "lodging_compliance_submissions"
      ADD CONSTRAINT "lodging_compliance_submissions_reservation_id_fkey"
      FOREIGN KEY ("reservation_id") REFERENCES "lodging_reservations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_compliance_submissions_guest_id_fkey') THEN
    ALTER TABLE "lodging_compliance_submissions"
      ADD CONSTRAINT "lodging_compliance_submissions_guest_id_fkey"
      FOREIGN KEY ("guest_id") REFERENCES "lodging_guests"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_compliance_submissions_reported_by_user_id_fkey') THEN
    ALTER TABLE "lodging_compliance_submissions"
      ADD CONSTRAINT "lodging_compliance_submissions_reported_by_user_id_fkey"
      FOREIGN KEY ("reported_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_compliance_credentials_store_id_fkey') THEN
    ALTER TABLE "lodging_compliance_credentials"
      ADD CONSTRAINT "lodging_compliance_credentials_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END
$$;
