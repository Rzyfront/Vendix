-- DATA IMPACT:
-- Tables affected: none existing. Creates lodging_units (empty) and the enum
-- lodging_housekeeping_status_enum.
-- Expected row changes: none.
-- Destructive operations: none.
-- FK/cascade risk: none. New FKs to stores and lodging_unit_types use ON DELETE RESTRICT.
-- Idempotency: guarded CREATE TYPE, CREATE TABLE/INDEX IF NOT EXISTS and guarded constraints.
-- Approval: hospitality plan, slice H0.3 (owner decisions 2026-10-26).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lodging_housekeeping_status_enum') THEN
    CREATE TYPE "lodging_housekeeping_status_enum" AS ENUM ('clean', 'dirty', 'inspected', 'out_of_order', 'out_of_service');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "lodging_units" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "unit_type_id" INTEGER NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "floor" VARCHAR(30),
    "zone" VARCHAR(60),
    "housekeeping_status" "lodging_housekeeping_status_enum" NOT NULL DEFAULT 'clean',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_units_store_id_code_key" ON "lodging_units"("store_id", "code");
CREATE INDEX IF NOT EXISTS "lodging_units_unit_type_id_is_active_idx" ON "lodging_units"("unit_type_id", "is_active");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_units_store_id_fkey') THEN
    ALTER TABLE "lodging_units" ADD CONSTRAINT "lodging_units_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_units_unit_type_id_fkey') THEN
    ALTER TABLE "lodging_units" ADD CONSTRAINT "lodging_units_unit_type_id_fkey"
      FOREIGN KEY ("unit_type_id") REFERENCES "lodging_unit_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
