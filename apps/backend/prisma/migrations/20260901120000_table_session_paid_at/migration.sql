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

ALTER TABLE table_sessions ADD COLUMN paid_at TIMESTAMP NULL;

CREATE INDEX table_sessions_paid_at_idx ON table_sessions(store_id, paid_at);
