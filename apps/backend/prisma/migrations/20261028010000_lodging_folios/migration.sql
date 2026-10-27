-- DATA IMPACT:
-- Tables affected: creates lodging_folios (empty) and the enum lodging_folio_status_enum.
-- Expected row changes: none. No existing table or row is modified.
-- Destructive operations: none.
-- FK/cascade risk: none. New FKs use ON DELETE RESTRICT.
-- Idempotency: guarded CREATE TYPE, CREATE TABLE/INDEX IF NOT EXISTS and guarded constraints.
-- Approval: hospitality plan, slice H3.2 (owner decisions 2026-10-26).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lodging_folio_status_enum') THEN
    CREATE TYPE "lodging_folio_status_enum" AS ENUM ('open', 'closed');
  END IF;
END $$;

-- Guest folio opened at check-in: one per reservation, its charges live in a
-- draft POS order (1:1), the same pattern as table_sessions.
CREATE TABLE IF NOT EXISTS "lodging_folios" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "reservation_id" INTEGER NOT NULL,
    "order_id" INTEGER NOT NULL,
    "status" "lodging_folio_status_enum" NOT NULL DEFAULT 'open',
    "opened_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_folios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lodging_folios_reservation_id_key" ON "lodging_folios"("reservation_id");
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_folios_order_id_key" ON "lodging_folios"("order_id");
CREATE INDEX IF NOT EXISTS "lodging_folios_store_id_status_idx" ON "lodging_folios"("store_id", "status");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_folios_store_id_fkey') THEN
    ALTER TABLE "lodging_folios" ADD CONSTRAINT "lodging_folios_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_folios_reservation_id_fkey') THEN
    ALTER TABLE "lodging_folios" ADD CONSTRAINT "lodging_folios_reservation_id_fkey"
      FOREIGN KEY ("reservation_id") REFERENCES "lodging_reservations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_folios_order_id_fkey') THEN
    ALTER TABLE "lodging_folios" ADD CONSTRAINT "lodging_folios_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
