-- carril D (lina) — D2 / soft cancel de items de orden
-- Permite cancelar items individuales sin necesidad de cancelar la orden
-- completa, manteniendo auditoría de QUIÉN canceló y POR QUÉ, además de
-- clasificar la operación contable:
--
--   * before_fire        — el item aún no se disparó a cocina; se revierte
--                          el stock consumido al preparar la línea.
--   * after_fire_waste   — el item ya se disparó (inventario consumido a
--                          fuego) y se anota como merma: NO se revierte
--                          stock, queda registro para auditoría e informes
--                          de desperdicio.
--
-- "cancelado" se modela como `cancelled_at IS NOT NULL` (no como columna
-- state enum): una columna menos, sin DEFAULT, sin backfill de filas
-- existentes, y lectura trivial en queries de totales.
--
-- DATA IMPACT:
--   Tables affected: order_items
--   Expected row changes: 0
--   Filas existentes quedan con cancelled_at = NULL, cancellation_reason = NULL
--   y cancellation_type = NULL (no son canceladas). Las tres columnas son
--   aditivas nullable, sin DEFAULT para no backfillar.

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(6);

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cancellation_reason" TEXT;

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cancellation_type" VARCHAR(20);

CREATE INDEX IF NOT EXISTS "order_items_order_id_cancelled_at_idx"
  ON "order_items"("order_id", "cancelled_at");

-- Endurecida por la orquestacion antes de aplicar: nombre del indice alineado
-- con el que Prisma deriva de `@@index([order_id, cancelled_at])` en
-- schema.prisma para evitar drift en el proximo `prisma migrate dev`.
