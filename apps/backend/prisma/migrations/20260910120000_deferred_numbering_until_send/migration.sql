-- =====================================================
-- A.1 CP-facturacion-fixes: invoice_number nullable hasta el envío
-- =====================================================
-- DATA IMPACT:
-- - Tabla afectada: invoices (ALTER COLUMN DROP NOT NULL, sin tocar filas)
-- - Cambios de filas esperados: 0
-- - Operaciones destructivas: NINGUNA. Sin DELETE / TRUNCATE / DROP / UPDATE.
-- - Idempotencia: DROP NOT NULL sobre columna ya-nullable es no-op (aviso, no error).
-- - Motivo: los borradores automáticos (web/whatsapp/POS) nacen sin número para no
--   quemar consecutivos DIAN en órdenes impagas; el número se asigna en validate().
--   Postgres trata NULLs como distintos en UNIQUE, sin colisiones.
-- =====================================================

ALTER TABLE "invoices" ALTER COLUMN "invoice_number" DROP NOT NULL;
