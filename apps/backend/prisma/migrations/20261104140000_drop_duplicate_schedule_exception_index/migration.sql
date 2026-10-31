-- fulfillment_schedule_exceptions tenía dos índices sobre (store_id, date):
-- uno normal y uno único. La regla de negocio es una excepción por fecha y
-- tienda, así que se conserva el único (que también sirve para búsquedas) y
-- se elimina el normal, redundante.
--
-- DATA IMPACT:
--   Tables affected: fulfillment_schedule_exceptions (index only).
--   Expected row changes: 0. No DML.
--   Destructive operations: ninguna sobre datos (solo DROP INDEX redundante).
--   Idempotency: DROP INDEX IF EXISTS; reejecutar no hace nada.

DROP INDEX IF EXISTS "fulfillment_schedule_exceptions_store_id_date_idx";
