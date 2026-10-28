-- DATA IMPACT:
-- Tables affected: creates lodging_allotments (empty).
-- Expected row changes: none. No existing table or row is modified.
-- Destructive operations: none.
-- FK/cascade risk: none. New FKs use ON DELETE RESTRICT.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS and guarded constraints.
-- Approval: hospitality plan, slice H2.5 (owner decisions 2026-10-26).

-- Rooms of a type held for an agency or company. to_date is the last night
-- held; unbooked rooms return to public sale release_days before each night.
CREATE TABLE IF NOT EXISTS "lodging_allotments" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "unit_type_id" INTEGER NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "rooms" INTEGER NOT NULL,
    "release_days" INTEGER NOT NULL DEFAULT 7,
    "notes" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_allotments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lodging_allotments_dates_check" CHECK ("to_date" >= "from_date"),
    CONSTRAINT "lodging_allotments_rooms_check" CHECK ("rooms" >= 1),
    CONSTRAINT "lodging_allotments_release_days_check" CHECK ("release_days" >= 0)
);

CREATE INDEX IF NOT EXISTS "lodging_allotments_store_id_is_active_from_date_to_date_idx" ON "lodging_allotments"("store_id", "is_active", "from_date", "to_date");
CREATE INDEX IF NOT EXISTS "lodging_allotments_unit_type_id_is_active_idx" ON "lodging_allotments"("unit_type_id", "is_active");
CREATE INDEX IF NOT EXISTS "lodging_allotments_customer_id_idx" ON "lodging_allotments"("customer_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_allotments_store_id_fkey') THEN
    ALTER TABLE "lodging_allotments" ADD CONSTRAINT "lodging_allotments_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_allotments_customer_id_fkey') THEN
    ALTER TABLE "lodging_allotments" ADD CONSTRAINT "lodging_allotments_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_allotments_unit_type_id_fkey') THEN
    ALTER TABLE "lodging_allotments" ADD CONSTRAINT "lodging_allotments_unit_type_id_fkey"
      FOREIGN KEY ("unit_type_id") REFERENCES "lodging_unit_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
