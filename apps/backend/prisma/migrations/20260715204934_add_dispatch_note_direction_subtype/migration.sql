-- DATA IMPACT:
-- Tables affected: dispatch_notes, return_orders
-- Expected row changes: none (all new columns are nullable or have defaults)
-- Destructive operations: none
-- FK/cascade risk: none (new FKs are OnDelete SetNull on nullable columns)
-- Idempotency: ALTER TYPE ADD VALUE IF NOT EXISTS; CREATE TYPE guarded by DO $$; ADD COLUMN IF NOT EXISTS; CREATE INDEX IF NOT EXISTS
-- Approval: documented in plan (Remisiones Bidireccionales — cimiento de datos)

-- 1. Add 'received' to existing dispatch_note_status_enum (idempotent)
ALTER TYPE "dispatch_note_status_enum" ADD VALUE IF NOT EXISTS 'received';

-- 2. Create new enums (idempotent — guarded by DO $$)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispatch_note_direction_enum') THEN
    CREATE TYPE "dispatch_note_direction_enum" AS ENUM ('outbound', 'inbound');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispatch_note_subtype_enum') THEN
    CREATE TYPE "dispatch_note_subtype_enum" AS ENUM ('customer_delivery', 'customer_return', 'transfer_out', 'transfer_in', 'purchase_receipt');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispatch_note_reason_enum') THEN
    CREATE TYPE "dispatch_note_reason_enum" AS ENUM ('sale', 'sample', 'consignment', 'replacement_shipment', 'loan', 'defective', 'wrong_item', 'cancellation', 'warranty', 'overdelivery_return', 'replenishment', 'rebalancing', 'transfer_to_consignee', 'returned_from_consignee', 'normal_purchase', 'replacement_for_damage', 'sample_received');
  END IF;
END $$;

-- 3. Add new columns to dispatch_notes (idempotent)
ALTER TABLE "dispatch_notes" ADD COLUMN IF NOT EXISTS "direction" "dispatch_note_direction_enum" NOT NULL DEFAULT 'outbound';
ALTER TABLE "dispatch_notes" ADD COLUMN IF NOT EXISTS "subtype" "dispatch_note_subtype_enum" NOT NULL DEFAULT 'customer_delivery';
ALTER TABLE "dispatch_notes" ADD COLUMN IF NOT EXISTS "reason" "dispatch_note_reason_enum";
ALTER TABLE "dispatch_notes" ADD COLUMN IF NOT EXISTS "supplier_id" INTEGER;
ALTER TABLE "dispatch_notes" ADD COLUMN IF NOT EXISTS "related_dispatch_id" INTEGER;
ALTER TABLE "dispatch_notes" ADD COLUMN IF NOT EXISTS "from_location_id" INTEGER;
ALTER TABLE "dispatch_notes" ADD COLUMN IF NOT EXISTS "to_location_id" INTEGER;

-- 4. Add related_dispatch_id to return_orders (idempotent)
ALTER TABLE "return_orders" ADD COLUMN IF NOT EXISTS "related_dispatch_id" INTEGER;

-- 5. Create indexes (idempotent)
CREATE INDEX IF NOT EXISTS "dispatch_notes_store_id_direction_subtype_idx" ON "dispatch_notes"("store_id", "direction", "subtype");
CREATE INDEX IF NOT EXISTS "dispatch_notes_supplier_id_idx" ON "dispatch_notes"("supplier_id");
CREATE INDEX IF NOT EXISTS "dispatch_notes_related_dispatch_id_idx" ON "dispatch_notes"("related_dispatch_id");
CREATE INDEX IF NOT EXISTS "dispatch_notes_from_location_id_idx" ON "dispatch_notes"("from_location_id");
CREATE INDEX IF NOT EXISTS "dispatch_notes_to_location_id_idx" ON "dispatch_notes"("to_location_id");
CREATE INDEX IF NOT EXISTS "return_orders_related_dispatch_id_idx" ON "return_orders"("related_dispatch_id");

-- 6. Add foreign keys (idempotent — guarded by DO $$ / IF NOT EXISTS)

-- dispatch_notes.supplier_id -> suppliers.id (OnDelete SetNull)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_notes_supplier_id_fkey') THEN
    ALTER TABLE "dispatch_notes" ADD CONSTRAINT "dispatch_notes_supplier_id_fkey"
      FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- dispatch_notes.related_dispatch_id -> dispatch_notes.id (self, OnDelete SetNull)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_notes_related_dispatch_id_fkey') THEN
    ALTER TABLE "dispatch_notes" ADD CONSTRAINT "dispatch_notes_related_dispatch_id_fkey"
      FOREIGN KEY ("related_dispatch_id") REFERENCES "dispatch_notes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- dispatch_notes.from_location_id -> inventory_locations.id (OnDelete SetNull)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_notes_from_location_id_fkey') THEN
    ALTER TABLE "dispatch_notes" ADD CONSTRAINT "dispatch_notes_from_location_id_fkey"
      FOREIGN KEY ("from_location_id") REFERENCES "inventory_locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- dispatch_notes.to_location_id -> inventory_locations.id (OnDelete SetNull)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_notes_to_location_id_fkey') THEN
    ALTER TABLE "dispatch_notes" ADD CONSTRAINT "dispatch_notes_to_location_id_fkey"
      FOREIGN KEY ("to_location_id") REFERENCES "inventory_locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- return_orders.related_dispatch_id -> dispatch_notes.id (OnDelete SetNull)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'return_orders_related_dispatch_id_fkey') THEN
    ALTER TABLE "return_orders" ADD CONSTRAINT "return_orders_related_dispatch_id_fkey"
      FOREIGN KEY ("related_dispatch_id") REFERENCES "dispatch_notes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;