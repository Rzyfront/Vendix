-- DATA IMPACT:
-- Tables affected: cash_register_movements (solo se agrega un INDICE UNICO PARCIAL; no muta filas).
-- Expected row changes: none. Impone "a lo sumo un movimiento 'sale' por payment_id".
-- Destructive operations: none (sin DROP/DELETE/TRUNCATE/UPDATE).
-- FK/cascade risk: none.
-- Idempotency: IF NOT EXISTS dentro de un bloque DO.
--
-- Contexto (caja B15): los reintentos podian duplicar el movimiento de venta de un pago.
--
-- Comportamiento ante duplicados: si ya existen dos 'sale' con el mismo payment_id, NO se crea
--   el indice (RAISE NOTICE) y la migracion termina sin error; los duplicados se resuelven con
--   un ajuste, nunca con borrado. Consulta:
--     SELECT payment_id, count(*) FROM cash_register_movements
--      WHERE type = 'sale' AND payment_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
--
-- Indices NO creados aqui (decision documentada):
--   * (store_id, type, reference) para refund/cash_in/cash_out: el codigo actual usa
--     referencias constantes y repetibles ('order_cancelled', 'payment_cancelled'), texto
--     libre en cash_in/cash_out manuales y 'Deposito reserva <n>' (varios depositos por
--     reserva). Un indice unico las rechazaria. La idempotencia de refund queda a nivel de
--     aplicacion en recordRefundMovement.
--   * (store_id, source_type, source_id, type): las columnas source_* llegan en T7.
--
-- Nota Prisma: schema.prisma NO se toca. Sin CONCURRENTLY (migracion transaccional).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema()
       AND indexname = 'cash_register_movements_one_sale_per_payment'
  ) THEN
    RAISE NOTICE 'cash_register_movements_one_sale_per_payment ya existe; sin cambios';
  ELSIF EXISTS (
    SELECT 1 FROM cash_register_movements
     WHERE type = 'sale' AND payment_id IS NOT NULL
     GROUP BY payment_id
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'cash_register_movements_one_sale_per_payment NO creado: hay pagos con mas de un movimiento sale. Resolver con ajuste (nunca borrado) y crear el indice.';
  ELSE
    CREATE UNIQUE INDEX "cash_register_movements_one_sale_per_payment"
      ON "cash_register_movements"("payment_id")
      WHERE "type" = 'sale' AND "payment_id" IS NOT NULL;
  END IF;
END $$;
