-- recipe_items.notes: anotación libre por insumo ("picar fino", "sin cáscara").
--
-- DATA IMPACT:
--   Tables affected: recipe_items (column only).
--   Expected row changes: 0. No DML.
--   Destructive operations: ninguna (solo ADD COLUMN nullable).
--   Idempotency: ADD COLUMN IF NOT EXISTS; reejecutar deja la misma columna.
--
-- Las recetas existentes quedan con notes = NULL (sin anotación). La UI no
-- pinta el bloque cuando está vacío, así que no cambia lo que ya se ve.

ALTER TABLE "recipe_items" ADD COLUMN IF NOT EXISTS "notes" TEXT;
