-- DATA IMPACT: none (additive nullable column)
-- Tables affected: withholding_calculations (nueva columna nullable order_id + índice + FK).
-- Existing row changes: ninguno; las filas históricas quedan con order_id NULL, sin backfill.
-- Destructive operations: ninguna; no hay DROP, DELETE, UPDATE, TRUNCATE ni CASCADE.
-- FK/cascade risk: order_id -> orders ON DELETE SET NULL ON UPDATE NO ACTION.
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS y FK guardada con
--   DO $$ ... pg_constraint ... para poder reintentar la migración sin error.
-- Approval: decisión del dueño en la revisión del PR #858 (hallazgo 2: enlazar la retención
--   sufrida del cobro a la factura en vez de duplicarla).

-- AlterTable
ALTER TABLE "withholding_calculations" ADD COLUMN IF NOT EXISTS "order_id" INTEGER;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "withholding_calculations_order_id_idx" ON "withholding_calculations"("order_id");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'withholding_calculations_order_id_fkey' AND conrelid = '"withholding_calculations"'::regclass) THEN
    ALTER TABLE "withholding_calculations" ADD CONSTRAINT "withholding_calculations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
