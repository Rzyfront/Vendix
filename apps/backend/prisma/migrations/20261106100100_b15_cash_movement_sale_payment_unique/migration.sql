-- DATA IMPACT:
-- Tables affected: cash_register_movements (solo se agrega un INDICE UNICO PARCIAL; no muta filas).
-- Expected row changes: none. Impone "a lo sumo un movimiento 'sale' por payment_id".
-- Destructive operations: none (sin DROP/DELETE/TRUNCATE/UPDATE).
-- FK/cascade risk: none.
-- Idempotency: IF NOT EXISTS dentro de un bloque DO (si el indice ya existe no hace nada).
--
-- Contexto (caja B15): los reintentos podian duplicar el movimiento de venta de un pago.
--
-- Comportamiento ante duplicados: si ya existen dos 'sale' con el mismo payment_id, la
--   migracion FALLA (RAISE EXCEPTION con los payment_id) y el deploy se detiene: el codigo
--   cuenta con este indice (P2002 en recordSaleMovement), asi que no puede quedar "aplicada"
--   sin el. Los duplicados se resuelven con un ajuste, nunca con borrado; luego se marca la
--   migracion --rolled-back y se redespliega. Consulta ANTES del deploy:
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
DECLARE
  dupes TEXT;
BEGIN
  SELECT string_agg(format('payment_id=%s sales=%s', payment_id, n), '; ')
    INTO dupes
    FROM (
      SELECT payment_id, count(*) AS n FROM cash_register_movements
       WHERE type = 'sale' AND payment_id IS NOT NULL
       GROUP BY payment_id
      HAVING count(*) > 1
       ORDER BY payment_id
       LIMIT 50
    ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'cash_register_movements_one_sale_per_payment NO creado: pagos con mas de un movimiento sale: %', dupes
      USING HINT = 'Resolver con ajuste (nunca borrado), marcar la migracion --rolled-back y redesplegar.';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema()
       AND indexname = 'cash_register_movements_one_sale_per_payment'
  ) THEN
    CREATE UNIQUE INDEX "cash_register_movements_one_sale_per_payment"
      ON "cash_register_movements"("payment_id")
      WHERE "type" = 'sale' AND "payment_id" IS NOT NULL;
  END IF;
END $$;
