-- DATA IMPACT:
-- Tables affected: dispatch_routes (adds shipping_method_id, external_carrier_supplier_id)
-- Expected row changes: none — additive nullable columns; existing routes default to NULL
--   (se mantienen operativas; el método se deriva de las órdenes via JOIN cuando
--   el FK está NULL).
-- Destructive operations: none (no DROP / no CASCADE / no DELETE / no UPDATE).
-- FK/cascade risk: FKs ON DELETE SET NULL; eliminar el método/proveedor nunca
--   elimina la ruta, solo nulea la referencia (la ruta sigue activa con su orden).
-- Idempotency: IF NOT EXISTS en columnas; pg_constraint guards en FKs.
-- Approval: Plan Despacho Economía (FASE 3) — cableado método↔ruta.

-- 1. Columnas nuevas (ambas opcionales para no romper rutas existentes).
ALTER TABLE "dispatch_routes"
  ADD COLUMN IF NOT EXISTS "shipping_method_id" INTEGER;
ALTER TABLE "dispatch_routes"
  ADD COLUMN IF NOT EXISTS "external_carrier_supplier_id" INTEGER;

-- 2. Índices.
CREATE INDEX IF NOT EXISTS "dispatch_routes_shipping_method_id_idx"
  ON "dispatch_routes"("shipping_method_id");
CREATE INDEX IF NOT EXISTS "dispatch_routes_external_carrier_supplier_id_idx"
  ON "dispatch_routes"("external_carrier_supplier_id");

-- 3. Foreign keys.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_routes_shipping_method_id_fkey'
  ) THEN
    ALTER TABLE "dispatch_routes"
      ADD CONSTRAINT "dispatch_routes_shipping_method_id_fkey"
      FOREIGN KEY ("shipping_method_id") REFERENCES "shipping_methods"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dispatch_routes_external_carrier_supplier_id_fkey'
  ) THEN
    ALTER TABLE "dispatch_routes"
      ADD CONSTRAINT "dispatch_routes_external_carrier_supplier_id_fkey"
      FOREIGN KEY ("external_carrier_supplier_id") REFERENCES "suppliers"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;