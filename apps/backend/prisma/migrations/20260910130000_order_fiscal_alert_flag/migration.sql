-- =====================================================
-- A.3 CP-facturacion-fixes: flag de alerta fiscal en órdenes
-- =====================================================
-- DATA IMPACT:
-- - Tabla afectada: orders (ADD COLUMN nullable, sin tocar filas)
-- - Cambios de filas esperados: 0 (todas las filas existentes quedan en NULL)
-- - Operaciones destructivas: NINGUNA. Sin DELETE / TRUNCATE / DROP / UPDATE.
-- - Idempotencia: ADD COLUMN IF NOT EXISTS.
-- - Motivo: surfacear fallos de emisión automática (webhook auto-send) que hoy
--   solo quedan en logs; NULL = sin alerta fiscal conocida.
-- =====================================================

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "fiscal_alert_code" VARCHAR(60);
