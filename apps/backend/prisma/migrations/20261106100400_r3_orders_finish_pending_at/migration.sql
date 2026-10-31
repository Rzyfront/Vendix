-- DATA IMPACT:
-- Tables affected: orders (se agrega UNA columna nullable y un indice; no muta filas).
-- Expected row changes: none. Las filas existentes quedan con finish_pending_at = NULL.
-- Destructive operations: none (sin DROP/DELETE/TRUNCATE/UPDATE).
-- FK/cascade risk: none (sin FKs nuevas).
-- Idempotency: ADD COLUMN IF NOT EXISTS y CREATE INDEX IF NOT EXISTS.
--
-- Contexto (caja B07, ronda 3 #6): el barrido de cierres pendientes buscaba el marcador con
-- internal_notes LIKE '%...%' (scan completo de orders cada 5 min). Ahora la orden con marcador
-- abierto lleva finish_pending_at (instante del ultimo intento) y el barrido filtra por indice.
-- Sin backfill: el marcador nace en esta misma rama (PR #1039), no hay marcadores previos en prod.

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "finish_pending_at" TIMESTAMP(6);

CREATE INDEX IF NOT EXISTS "orders_finish_pending_at_idx" ON "orders"("finish_pending_at");
