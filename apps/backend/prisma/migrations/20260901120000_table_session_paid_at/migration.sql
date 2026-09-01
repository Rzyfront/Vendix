-- carril D (lina) — D1 / QUI: mesa marcada como pagada en POS
-- Marca el instante en que `table_sessions` queda pagada (≠ cerrada).
-- La mesa sigue ocupada hasta que el mesero la libere explícitamente;
-- esta columna distingue "ocupada sin pagar" de "ocupada pagada".
--
-- DATA IMPACT:
--   Tables affected: table_sessions
--   Expected row changes: 0
--   Las filas existentes quedan con paid_at = NULL (siguen ocupadas sin pagar).
--   Columna aditiva nullable, sin DEFAULT para no backfillar.

ALTER TABLE "table_sessions" ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(6);

CREATE INDEX IF NOT EXISTS "table_sessions_store_id_paid_at_idx" ON "table_sessions"("store_id", "paid_at");

-- Endurecida por la orquestacion antes de aplicar: IF NOT EXISTS en ambas
-- sentencias para que la migracion sea re-ejecutable, y el indice renombrado a
-- table_sessions_store_id_paid_at_idx, que es el nombre que Prisma deriva de
-- @@index([store_id, paid_at]) en schema.prisma. Con el nombre anterior
-- (table_sessions_paid_at_idx) el proximo migrate dev habria generado drift.
