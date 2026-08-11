-- DATA IMPACT:
-- Tables affected:
--   product_price_tier_assignments → +2 columnas (store_id, barcode) y un
--     UPDATE acotado que copia el store_id del producto dueño de cada fila.
-- Expected row changes: tantas filas como assignments existan (en producción
--   son decenas: la feature de presentaciones aún no tiene adopción). Ninguna
--   fila de negocio cambia de significado: store_id es redundante con
--   products.store_id y se denormaliza SOLO para poder exigir unicidad de
--   código de barras por tienda.
-- Destructive operations: none — sin DROP, sin CASCADE, sin DELETE.
-- FK/cascade risk: la FK nueva a stores usa ON DELETE CASCADE igual que
--   products.store_id; borrar una tienda ya borraba sus productos y con ellos
--   estos assignments.
-- Idempotency: ADD COLUMN IF NOT EXISTS + UPDATE con WHERE + índices IF NOT EXISTS.
-- Approval: QUI-648 fase 2, paso 13 — plan aprobado en chat.

-- ---------------------------------------------------------------------
-- 1) Código de barras por par (producto, presentación)
--    El barcode identifica la presentación concreta: la "Caja x12" de dos
--    productos distintos nunca comparte código, y la caja no comparte código
--    con la unidad suelta. Por eso vive en el par y no en la tarifa, que es
--    de tienda.
-- ---------------------------------------------------------------------
ALTER TABLE "product_price_tier_assignments"
  ADD COLUMN IF NOT EXISTS "barcode" VARCHAR(64);

-- ---------------------------------------------------------------------
-- 2) store_id denormalizado
--    La unicidad del código es POR TIENDA —dos comercios distintos pueden
--    pistolear el mismo EAN— y un índice único no puede atravesar un JOIN.
--    Se rellena desde el producto dueño, que es la única fuente posible.
-- ---------------------------------------------------------------------
ALTER TABLE "product_price_tier_assignments"
  ADD COLUMN IF NOT EXISTS "store_id" INTEGER;

UPDATE "product_price_tier_assignments" a
   SET "store_id" = p."store_id"
  FROM "products" p
 WHERE p."id" = a."product_id"
   AND a."store_id" IS DISTINCT FROM p."store_id";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'product_price_tier_assignments_store_id_fkey'
  ) THEN
    ALTER TABLE "product_price_tier_assignments"
      ADD CONSTRAINT "product_price_tier_assignments_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3) Unicidad parcial: solo cuando hay código.
--    Postgres permite N filas con NULL bajo un índice único, así que las
--    presentaciones sin código conviven sin restricción.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "ppta_store_barcode_unique"
  ON "product_price_tier_assignments"("store_id", "barcode")
  WHERE "barcode" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "ppta_store_id_idx"
  ON "product_price_tier_assignments"("store_id");
