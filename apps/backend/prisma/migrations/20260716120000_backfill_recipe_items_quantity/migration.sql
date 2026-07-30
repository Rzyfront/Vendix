-- Migration: backfill recipe_items.quantity and add positive CHECK constraint
--
<<<<<<< HEAD
=======
-- DATA IMPACT:
--   Tabla mutada:  recipe_items (solo la columna `quantity`)
--   Sentencia:     UPDATE ... WHERE quantity IS NULL OR quantity <= 0
--   Filas:         verificar el conteo ANTES del deploy a prod con
--                    SELECT count(*) FROM recipe_items
--                    WHERE quantity IS NULL OR quantity <= 0;
--                  Se esperan pocas filas (recetas creadas con el form roto).
--                  Si el conteo es alto, NO aplicar: revisar primero.
--   Reversible:    NO. El valor original (NULL / 0) se pierde; esas filas ya
--                  eran invalidas para el dominio (una receta no puede
--                  consumir 0 de un insumo), pero conviene snapshot de prod.
--   Sin DELETE, sin DROP, sin CASCADE, sin TRUNCATE. No se borran filas, así
--   que las FK entrantes a recipe_items no se ven afectadas.
--   Requiere aprobación explícita + snapshot de prod antes del deploy.
--
>>>>>>> origin/dev
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
<<<<<<< HEAD
ALTER TABLE recipe_items VALIDATE CONSTRAINT recipe_items_quantity_positive;
=======
ALTER TABLE recipe_items VALIDATE CONSTRAINT recipe_items_quantity_positive;
>>>>>>> origin/dev
