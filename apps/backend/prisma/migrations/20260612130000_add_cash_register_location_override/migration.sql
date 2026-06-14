-- DATA IMPACT:
-- Tables affected: cash_registers (ADD nullable column + FK to inventory_locations)
-- Expected row changes: 0 (additive nullable, no backfill required)
-- Destructive operations: none
-- FK/cascade risk: ON DELETE SET NULL (non-destructive: nulls the override if the warehouse is deleted)
-- Idempotency: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS + FK guarded by pg_constraint check
-- Approval: documented in plan (ayudame-a-solucionar-este-crispy-mango.md)
--
-- Adds an optional warehouse override to a cash register. When set, this register
-- will discount stock from this location instead of the store's default_location_id.
-- When null, the POS flow falls back to stores.default_location_id.

ALTER TABLE "cash_registers"
  ADD COLUMN IF NOT EXISTS "location_id" INTEGER;

CREATE INDEX IF NOT EXISTS "cash_registers_location_id_idx"
  ON "cash_registers"("location_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cash_registers_location_id_fkey'
  ) THEN
    ALTER TABLE "cash_registers"
      ADD CONSTRAINT "cash_registers_location_id_fkey"
      FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
