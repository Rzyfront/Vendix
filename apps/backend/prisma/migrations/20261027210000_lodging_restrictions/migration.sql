-- DATA IMPACT:
-- Tables affected: none existing. Creates lodging_restrictions (empty).
-- Expected row changes: none.
-- Destructive operations: none.
-- FK/cascade risk: none. New FKs use ON DELETE RESTRICT.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS and guarded constraints.
-- Approval: hospitality plan, slice H2.3 (owner decisions 2026-10-26).

-- Stay restrictions of one night. unit_type_id NULL = every room type.
CREATE TABLE IF NOT EXISTS "lodging_restrictions" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "unit_type_id" INTEGER,
    "date" DATE NOT NULL,
    "min_stay" INTEGER,
    "max_stay" INTEGER,
    "closed_to_arrival" BOOLEAN NOT NULL DEFAULT false,
    "closed_to_departure" BOOLEAN NOT NULL DEFAULT false,
    "stop_sell" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_restrictions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lodging_restrictions_stay_check" CHECK (
      ("min_stay" IS NULL OR "min_stay" >= 1)
      AND ("max_stay" IS NULL OR "max_stay" >= 1)
      AND ("min_stay" IS NULL OR "max_stay" IS NULL OR "max_stay" >= "min_stay")
    )
);

CREATE INDEX IF NOT EXISTS "lodging_restrictions_store_id_date_idx" ON "lodging_restrictions"("store_id", "date");
CREATE INDEX IF NOT EXISTS "lodging_restrictions_unit_type_id_idx" ON "lodging_restrictions"("unit_type_id");
-- One row per night and scope: every type, or one type.
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_restrictions_all_types_key" ON "lodging_restrictions"("store_id", "date") WHERE "unit_type_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_restrictions_unit_type_key" ON "lodging_restrictions"("store_id", "unit_type_id", "date") WHERE "unit_type_id" IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_restrictions_store_id_fkey') THEN
    ALTER TABLE "lodging_restrictions" ADD CONSTRAINT "lodging_restrictions_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_restrictions_unit_type_id_fkey') THEN
    ALTER TABLE "lodging_restrictions" ADD CONSTRAINT "lodging_restrictions_unit_type_id_fkey"
      FOREIGN KEY ("unit_type_id") REFERENCES "lodging_unit_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
