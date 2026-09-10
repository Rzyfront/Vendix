-- =====================================================
-- A.4 CP-facturacion-fixes: tabla de Idempotency-Key del checkout web
-- =====================================================
-- DATA IMPACT:
-- - Tablas afectadas: ninguna existente. CREATE TABLE nueva.
-- - Cambios de filas esperados: 0
-- - Operaciones destructivas: NINGUNA. Sin DELETE / TRUNCATE / DROP / UPDATE.
-- - Idempotencia: CREATE TABLE IF NOT EXISTS + ADD CONSTRAINT IF NOT EXISTS.
-- - Motivo: un doble submit no debe crear dos órdenes/facturas; la segunda
--   llegada con la misma key recibe la primera respuesta (TTL 24h).
-- =====================================================

CREATE TABLE IF NOT EXISTS "checkout_idempotency_keys" (
  "id" SERIAL PRIMARY KEY,
  "store_id" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(100) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "response" JSONB,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(6) NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checkout_idempotency_keys_store_id_idempotency_key_key'
  ) THEN
    ALTER TABLE "checkout_idempotency_keys"
      ADD CONSTRAINT "checkout_idempotency_keys_store_id_idempotency_key_key"
      UNIQUE ("store_id", "idempotency_key");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "checkout_idempotency_keys_expires_at_idx"
  ON "checkout_idempotency_keys" ("expires_at");
