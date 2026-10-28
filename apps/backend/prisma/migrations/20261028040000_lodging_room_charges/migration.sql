-- DATA IMPACT:
-- Tables affected: lodging_folios gains charges_blocked (NOT NULL DEFAULT false); creates lodging_room_charges (empty).
-- Expected row changes: none. Existing folios read the default false (charges allowed).
-- Destructive operations: none.
-- FK/cascade risk: none. New FKs use ON DELETE RESTRICT; no incoming FK changes.
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE TABLE/INDEX IF NOT EXISTS and guarded constraints.
-- Approval: hospitality plan, slice H3.6 (owner decisions 2026-10-26, D5).

-- H3.6: "Cargos bloqueados" — the POS and the tables cannot charge this room.
ALTER TABLE "lodging_folios" ADD COLUMN IF NOT EXISTS "charges_blocked" BOOLEAN NOT NULL DEFAULT false;

-- H3.6: a POS sale or table bill charged to an in-house room. Its lines moved
-- to the folio order and the source order was cancelled without payment.
CREATE TABLE IF NOT EXISTS "lodging_room_charges" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "folio_id" INTEGER NOT NULL,
    "reservation_room_id" INTEGER NOT NULL,
    "source_order_id" INTEGER NOT NULL,
    "table_session_id" INTEGER,
    "origin" VARCHAR(80) NOT NULL,
    "item_ids" INTEGER[],
    "amount" DECIMAL(14,2) NOT NULL,
    "cost_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_room_charges_pkey" PRIMARY KEY ("id")
);

-- One charge per source order: a double click never moves a sale twice.
CREATE UNIQUE INDEX IF NOT EXISTS "lodging_room_charges_source_order_id_key" ON "lodging_room_charges"("source_order_id");
CREATE INDEX IF NOT EXISTS "lodging_room_charges_folio_id_idx" ON "lodging_room_charges"("folio_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_room_charges_store_id_fkey') THEN
    ALTER TABLE "lodging_room_charges" ADD CONSTRAINT "lodging_room_charges_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_room_charges_folio_id_fkey') THEN
    ALTER TABLE "lodging_room_charges" ADD CONSTRAINT "lodging_room_charges_folio_id_fkey"
      FOREIGN KEY ("folio_id") REFERENCES "lodging_folios"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lodging_room_charges_source_order_id_fkey') THEN
    ALTER TABLE "lodging_room_charges" ADD CONSTRAINT "lodging_room_charges_source_order_id_fkey"
      FOREIGN KEY ("source_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
