-- Migration: backfill recipe_items.quantity and add positive CHECK constraint
--
-- Cierra el bug "Recetas admiten sub-componentes con CANTIDAD vacia"
-- (Combo Marinero de la tienda demo Miramor tenia 2 sub-componentes con
-- quantity NULL/vacia, persistidos como 0 al renderizar el form).
--
-- Pasos:
--   1. Backfill: cualquier row con quantity NULL o <= 0 pasa a 1.
--      Solo afecta a la receta demo rota; las recetas validas no se tocan.
--   2. CHECK constraint: defense in depth a nivel DB. Aunque los validators
--      del backend y frontend ahora rechazan 0, el CHECK bloquea cualquier
--      INSERT/UPDATE que se cuele por otro path (SQL directo, script
--      de seed, etc).

-- 1. Backfill quantity invalido a 1.
UPDATE recipe_items
SET quantity = 1
WHERE quantity IS NULL OR quantity <= 0;

-- 2. CHECK constraint a nivel DB. NOT VALID solo en caso de rollback
--    (si la migracion falla por algun row inesperado, el admin puede
--    limpiar manualmente y reintentar).
ALTER TABLE recipe_items
  ADD CONSTRAINT recipe_items_quantity_positive CHECK (quantity > 0) NOT VALID;

-- Valida el constraint para los rows existentes (los recien backfilled
-- pasan; cualquier row que no cumpla sera reportado aqui).
ALTER TABLE recipe_items VALIDATE CONSTRAINT recipe_items_quantity_positive;
