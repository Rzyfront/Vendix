-- DATA IMPACT:
-- Tables affected: orders (add columns dispatch_pool_at, claimed_by_carrier_user_id), dispatch_routes (add column is_carrier_route)
-- Expected row changes: none. Nullable cols + defaulted boolean; existing rows unaffected.
-- Destructive operations: none
-- FK/cascade risk: orders.claimed_by_carrier_user_id -> users(id) ON DELETE SET NULL (nullable, safe)
-- Idempotency: guarded by IF NOT EXISTS / DO $$ duplicate_object
-- Approval: Fase B4 del plan Vendix Repartos

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "dispatch_pool_at" timestamp(6);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "claimed_by_carrier_user_id" integer;

DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_claimed_by_carrier_fk"
    FOREIGN KEY ("claimed_by_carrier_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "orders_store_pool_idx" ON "orders" ("store_id","dispatch_pool_at");

ALTER TABLE "dispatch_routes" ADD COLUMN IF NOT EXISTS "is_carrier_route" boolean NOT NULL DEFAULT false;

-- Una ruta carrier activa por conductor. Excluye TODAS las filas existentes (is_carrier_route=false).
-- Índice parcial único: NO representable en @@unique de Prisma → vive solo en este SQL.
CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_routes_active_carrier_driver_idx"
  ON "dispatch_routes" ("driver_user_id")
  WHERE "is_carrier_route" = true AND "status" IN ('draft','dispatched','in_transit');
