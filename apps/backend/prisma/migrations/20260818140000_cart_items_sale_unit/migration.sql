-- El carrito de la tienda en línea aprende a recordar en qué PRESENTACIÓN se
-- eligió cada línea (bulto/kilo, rollo/metro), no solo qué producto.
--
-- DATA IMPACT:
--   Tabla afectada: cart_items (ADD COLUMN x2 nullable, FK nueva, swap del
--     índice único de identidad de línea).
--   Filas esperadas: 0 INSERT / 0 UPDATE / 0 DELETE. Es DDL puro. Las líneas
--     existentes quedan con las columnas nuevas en NULL, que es exactamente el
--     significado "sin presentación elegida" = comportamiento legacy.
--   Destructivo: NO. Sin DROP TABLE, sin DROP COLUMN, sin DELETE, sin UPDATE,
--     sin TRUNCATE, sin CASCADE. El único DROP es el de un ÍNDICE que se
--     reemplaza por otro más ancho en la misma transacción implícita.
--   Idempotente: SÍ. ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS,
--     CREATE INDEX IF NOT EXISTS, DROP INDEX IF EXISTS.
--   Riesgo de FK/cascade: ninguno. La FK nueva es ON DELETE SET NULL, espejando
--     order_items.applied_price_tier: borrar una tarifa no puede borrar el
--     carrito de nadie.
--   Precondición: PostgreSQL 15+ por NULLS NOT DISTINCT. Verificado en local
--     (15.17) y guardado tras una guarda que degrada en vez de abortar.
--   Aprobación: solicitada y otorgada por el usuario (2026-08-18) como parte de
--     la ejecución del plan de multi-tarifa en tienda en línea.
--
-- POR QUÉ `stock_units_consumed` en el carrito es CACHÉ y no verdad: el checkout
-- lo recalcula siempre desde la presentación autorizada. Vive aquí para que
-- getCartSummary pueda alimentar el predicado `isSoldByPresentation` del motor
-- de promociones sin una lectura extra por línea.
--
-- POR QUÉ NO se guarda `applied_price_tier_name_snapshot`: el carrito no es un
-- artefacto de auditoría — la orden sí lo es, y ahí el snapshot existe porque
-- la factura debe sobrevivir al renombre de la tarifa. Guardar un nombre en el
-- carrito solo invitaría la deriva que el snapshot de la orden existe para
-- evitar. El nombre se resuelve en lectura.

ALTER TABLE "cart_items"
  ADD COLUMN IF NOT EXISTS "applied_price_tier_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "stock_units_consumed" INTEGER;

ALTER TABLE "cart_items"
  DROP CONSTRAINT IF EXISTS "cart_items_applied_price_tier_id_fkey";

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_applied_price_tier_id_fkey"
  FOREIGN KEY ("applied_price_tier_id") REFERENCES "price_tiers"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX IF NOT EXISTS "cart_items_applied_price_tier_id_idx"
  ON "cart_items"("applied_price_tier_id");

-- Swap del índice de identidad de línea.
--
-- POR QUÉ NULLS NOT DISTINCT: los productos con presentación NO tienen variantes
-- (regla tiers ⊕ variantes, QUI-648), así que en esas líneas product_variant_id
-- es SIEMPRE NULL. Bajo el default de Postgres (NULLS DISTINCT) un índice único
-- que incluya esa columna no protege absolutamente nada en el caso que importa:
-- dos filas con NULL nunca colisionan. Sin NULLS NOT DISTINCT, esta migración
-- daría una falsa sensación de unicidad.
--
-- POR QUÉ la guarda en vez de un CREATE a secas: si producción arrastra líneas
-- duplicadas de carritos viejos, un CREATE UNIQUE INDEX pelado ABORTA el deploy
-- y deja la migración en P3009. Preferimos degradar: se conserva el índice
-- anterior, la unicidad queda a nivel aplicación (findFirst sobre las 4
-- columnas, que es lo que hace el servicio de todos modos) y el WARNING deja
-- rastro para limpiar aparte. Limpiar filas de carrito DENTRO de una migración
-- está prohibido por las reglas del repo.
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT cart_id, product_id, product_variant_id, applied_price_tier_id
    FROM "cart_items"
    GROUP BY 1, 2, 3, 4
    HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE WARNING 'cart_items: % grupos duplicados en (cart_id, product_id, product_variant_id, applied_price_tier_id). Se CONSERVA el índice único anterior y la unicidad queda a nivel aplicación. Limpiar en un ticket aparte antes de reintentar el índice ancho.', dup_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "cart_items_line_identity_key"
      ON "cart_items"("cart_id", "product_id", "product_variant_id", "applied_price_tier_id")
      NULLS NOT DISTINCT;

    DROP INDEX IF EXISTS "cart_items_cart_id_product_id_product_variant_id_key";
  END IF;
END $$;
