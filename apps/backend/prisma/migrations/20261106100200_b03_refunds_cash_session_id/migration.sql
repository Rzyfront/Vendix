-- DATA IMPACT:
-- Tables affected: refunds (se agrega UNA columna nullable, un indice y una FK; no muta filas).
-- Expected row changes: none. Las filas existentes quedan con cash_session_id = NULL (el reporte
--   de cierre usa su heuristica de ventana de tiempo cuando la columna es NULL).
-- Destructive operations: none (sin DROP/DELETE/TRUNCATE/UPDATE).
-- FK/cascade risk: FK hacia cash_register_sessions con ON DELETE SET NULL (no borra refunds).
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS y la FK dentro de un bloque DO.
--
-- Contexto (caja B03): el efectivo de un reembolso sale del cajon de quien lo entrega. La sesion
-- donde se asento el movimiento se guarda en refunds.cash_session_id.

ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "cash_session_id" INTEGER;

CREATE INDEX IF NOT EXISTS "refunds_cash_session_id_idx" ON "refunds"("cash_session_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'refunds_cash_session_id_fkey'
  ) THEN
    ALTER TABLE "refunds"
      ADD CONSTRAINT "refunds_cash_session_id_fkey"
      FOREIGN KEY ("cash_session_id") REFERENCES "cash_register_sessions"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
