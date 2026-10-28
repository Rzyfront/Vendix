-- DATA IMPACT:
-- Tables affected: none existing. Creates lodging_unit_types (empty).
-- Expected row changes: none.
-- Destructive operations: none.
-- FK/cascade risk: none. New FKs to stores and products use ON DELETE RESTRICT.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS and guarded constraints.
-- Approval: hospitality plan, slice H0.2 (owner decisions 2026-10-26).

CREATE TABLE IF NOT EXISTS "lodging_unit_types" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(30),
    "description" TEXT,
    "base_occupancy" INTEGER NOT NULL DEFAULT 1,
    "max_adults" INTEGER NOT NULL,
    "max_children" INTEGER NOT NULL DEFAULT 0,
    "max_occupancy" INTEGER NOT NULL,
    "bed_config" VARCHAR(255),
    "overbooking_allowance" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_unit_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_unit_types_product_id_key" ON "lodging_unit_types"("product_id");
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_unit_types_store_id_name_key" ON "lodging_unit_types"("store_id", "name");
CREATE INDEX IF NOT EXISTS "lodging_unit_types_store_id_is_active_idx" ON "lodging_unit_types"("store_id", "is_active");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_unit_types_store_id_fkey') THEN
    ALTER TABLE "lodging_unit_types" ADD CONSTRAINT "lodging_unit_types_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_unit_types_product_id_fkey') THEN
    ALTER TABLE "lodging_unit_types" ADD CONSTRAINT "lodging_unit_types_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
