-- DATA IMPACT:
-- Tables affected: creates lodging_inventory_blocks (empty) and the enum
--   lodging_inventory_block_reason_enum.
-- Expected row changes: none. No existing table or row is modified.
-- Destructive operations: none.
-- FK/cascade risk: none. New FKs use ON DELETE RESTRICT.
-- Idempotency: guarded CREATE TYPE, CREATE TABLE/INDEX IF NOT EXISTS and guarded constraints.
-- Approval: hospitality plan, slice H5.3 (owner decisions 2026-10-26).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lodging_inventory_block_reason_enum') THEN
    CREATE TYPE "lodging_inventory_block_reason_enum" AS ENUM ('maintenance', 'owner_use', 'ical');
  END IF;
END $$;

-- Room out of sale for the nights [from_date, to_date) without a reservation.
-- Active while released_at is null.
CREATE TABLE IF NOT EXISTS "lodging_inventory_blocks" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "unit_id" INTEGER NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "reason" "lodging_inventory_block_reason_enum" NOT NULL DEFAULT 'maintenance',
    "notes" VARCHAR(500),
    "created_by_user_id" INTEGER,
    "released_at" TIMESTAMP(6),
    "released_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_inventory_blocks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lodging_inventory_blocks_store_id_unit_id_from_date_to_date_idx"
  ON "lodging_inventory_blocks"("store_id", "unit_id", "from_date", "to_date");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_inventory_blocks_store_id_fkey') THEN
    ALTER TABLE "lodging_inventory_blocks" ADD CONSTRAINT "lodging_inventory_blocks_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_inventory_blocks_unit_id_fkey') THEN
    ALTER TABLE "lodging_inventory_blocks" ADD CONSTRAINT "lodging_inventory_blocks_unit_id_fkey"
      FOREIGN KEY ("unit_id") REFERENCES "lodging_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
