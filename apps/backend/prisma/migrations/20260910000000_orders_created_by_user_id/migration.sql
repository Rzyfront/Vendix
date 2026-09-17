-- DATA IMPACT:
-- Tables affected:
--   · orders — 1 columna AGREGADA (`created_by_user_id`, nullable, sin DEFAULT)
--   · users — FK referencia desde orders(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
-- Expected row changes: 0 filas eliminadas. Backfill seguro e idempotente de órdenes históricas
--   desde cash_register_movements(user_id) si existe movimiento asociado.
-- Destructive operations: NINGUNA. Solo ADD COLUMN, ADD CONSTRAINT, CREATE INDEX.
-- FK/cascade risk: ON DELETE SET NULL protege registros históricos si un usuario es eliminado.
-- Idempotency: DO $$ guardado por information_schema y pg_constraint. Reejecutable.
-- Approval: plan-reporte-ventas-por-usuario-vendedor (QUI-551).
-- Rollback: ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_created_by_user_id_fkey";
--           DROP INDEX IF EXISTS "orders_created_by_user_id_idx";
--           DROP INDEX IF EXISTS "orders_store_id_created_by_user_id_idx";
--           ALTER TABLE "orders" DROP COLUMN IF EXISTS "created_by_user_id";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'created_by_user_id'
  ) THEN
    ALTER TABLE "orders" ADD COLUMN "created_by_user_id" INTEGER;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_created_by_user_id_fkey'
  ) THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "orders_created_by_user_id_idx" ON "orders"("created_by_user_id");
CREATE INDEX IF NOT EXISTS "orders_store_id_created_by_user_id_idx" ON "orders"("store_id", "created_by_user_id");

-- Backfill seguro desde cash_register_movements para órdenes existentes que tienen movimiento de caja asociado:
UPDATE "orders" o
SET "created_by_user_id" = crm."user_id"
FROM (
  SELECT DISTINCT ON ("order_id") "order_id", "user_id"
  FROM "cash_register_movements"
  WHERE "order_id" IS NOT NULL AND "user_id" IS NOT NULL
  ORDER BY "order_id", "id" ASC
) crm
WHERE o."id" = crm."order_id" AND o."created_by_user_id" IS NULL;

-- Backfill seguro desde payments metadata para órdenes POS existentes:
UPDATE "orders" o
SET "created_by_user_id" = (p.gateway_response->'metadata'->>'seller_user_id')::INTEGER
FROM "payments" p
WHERE p."order_id" = o."id"
  AND o."created_by_user_id" IS NULL
  AND p.gateway_response->'metadata'->>'seller_user_id' ~ '^[0-9]+$';
