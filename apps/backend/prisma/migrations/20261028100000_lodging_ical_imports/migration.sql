-- DATA IMPACT:
-- Tables affected: new table lodging_ical_imports; lodging_inventory_blocks
--   gains the nullable columns ical_import_id and external_uid, one FK and
--   one index.
-- Expected row changes: none. Existing blocks keep NULL (not imported).
-- Destructive operations: none.
-- FK/cascade risk: lodging_ical_imports -> stores / lodging_units ON DELETE
--   RESTRICT; lodging_inventory_blocks.ical_import_id -> lodging_ical_imports
--   ON DELETE SET NULL (a block never disappears with its source). No CASCADE.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS and
--   guarded ADD CONSTRAINT.
-- Approval: hospitality plan, slice H6.2 (owner decisions 2026-10-26).

-- An external calendar (Airbnb, Booking...) imported into one room.
CREATE TABLE IF NOT EXISTS "lodging_ical_imports" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "unit_id" INTEGER NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "url" VARCHAR(2000) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "last_synced_at" TIMESTAMP(6),
  "last_sync_status" VARCHAR(10),
  "last_sync_message" VARCHAR(500),
  "last_sync_events" INTEGER,
  "created_by_user_id" INTEGER,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lodging_ical_imports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lodging_ical_imports_store_id_is_active_idx"
  ON "lodging_ical_imports"("store_id", "is_active");
CREATE INDEX IF NOT EXISTS "lodging_ical_imports_unit_id_idx"
  ON "lodging_ical_imports"("unit_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_ical_imports_store_id_fkey') THEN
    ALTER TABLE "lodging_ical_imports" ADD CONSTRAINT "lodging_ical_imports_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_ical_imports_unit_id_fkey') THEN
    ALTER TABLE "lodging_ical_imports" ADD CONSTRAINT "lodging_ical_imports_unit_id_fkey"
      FOREIGN KEY ("unit_id") REFERENCES "lodging_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- Blocks created by an import: their source and the event UID of the channel.
ALTER TABLE "lodging_inventory_blocks" ADD COLUMN IF NOT EXISTS "ical_import_id" INTEGER;
ALTER TABLE "lodging_inventory_blocks" ADD COLUMN IF NOT EXISTS "external_uid" VARCHAR(255);

CREATE INDEX IF NOT EXISTS "lodging_inventory_blocks_ical_import_id_external_uid_idx"
  ON "lodging_inventory_blocks"("ical_import_id", "external_uid");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_inventory_blocks_ical_import_id_fkey') THEN
    ALTER TABLE "lodging_inventory_blocks" ADD CONSTRAINT "lodging_inventory_blocks_ical_import_id_fkey"
      FOREIGN KEY ("ical_import_id") REFERENCES "lodging_ical_imports"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
