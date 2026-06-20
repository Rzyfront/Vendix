-- DATA IMPACT: 0 rows mutated; additive only (order_id, needs_collection nullable + FK + index)
-- Tables affected: dispatch_notes (schema only)
-- Expected row changes: none (additive columns are nullable / defaulted)
-- Destructive operations: none (no DROP/TRUNCATE/CASCADE/DELETE/UPDATE)
-- FK/cascade risk: none — order_id FK uses ON DELETE RESTRICT
-- Idempotency: guarded by IF NOT EXISTS and pg_constraint DO-block guard
-- Approval: additive-only link order -> dispatch_note (planillas DSD)

-- 1. Additive nullable columns
ALTER TABLE "dispatch_notes" ADD COLUMN IF NOT EXISTS "order_id" INTEGER;
ALTER TABLE "dispatch_notes" ADD COLUMN IF NOT EXISTS "needs_collection" BOOLEAN DEFAULT false;

-- 2. Idempotent FK to orders(id) ON DELETE RESTRICT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_notes_order_id_fkey'
  ) THEN
    ALTER TABLE "dispatch_notes"
      ADD CONSTRAINT "dispatch_notes_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- 3. Idempotent composite index (tenant filter + order lookup)
CREATE INDEX IF NOT EXISTS "dispatch_notes_store_id_order_id_idx" ON "dispatch_notes"("store_id", "order_id");
