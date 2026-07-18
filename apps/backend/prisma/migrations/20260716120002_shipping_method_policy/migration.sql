-- DATA IMPACT:
-- Tables affected: shipping_methods (adds 7 policy columns + 3 enums)
-- Expected row changes: none — additive nullable columns; existing rows default to
--   `collects_payment=false`, `generates_transport_cost=none`, payment_timing=on_delivery,
--   cost_settlement_timing=immediate_on_close. Comportamiento legacy preservado.
-- Destructive operations: none (no DROP / no CASCADE / no DELETE / no UPDATE).
-- FK/cascade risk: FKs son ON DELETE SET NULL; las relaciones son opcionales
--   y nunca propagan delete.
-- Idempotency: IF NOT EXISTS en columnas + DO $$ en enums + guard pg_constraint
--   en FKs.
-- Approval: Plan Despacho Economía (FASE 2) — política tipada por método.

-- 1. Enums de política.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispatch_payment_timing_enum') THEN
    CREATE TYPE "dispatch_payment_timing_enum" AS ENUM ('prepaid', 'on_delivery');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cost_settlement_timing_enum') THEN
    CREATE TYPE "cost_settlement_timing_enum" AS ENUM ('immediate_on_close');
  END IF;
END $$;

-- 2. Columnas de política (todas opcionales; defaults preservan el comportamiento legacy).
ALTER TABLE "shipping_methods"
  ADD COLUMN IF NOT EXISTS "collects_payment" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "shipping_methods"
  ADD COLUMN IF NOT EXISTS "payment_timing" "dispatch_payment_timing_enum" DEFAULT 'on_delivery';
ALTER TABLE "shipping_methods"
  ADD COLUMN IF NOT EXISTS "generates_transport_cost" "settlement_type_enum" NOT NULL DEFAULT 'none';
ALTER TABLE "shipping_methods"
  ADD COLUMN IF NOT EXISTS "default_vehicle_id" INTEGER;
ALTER TABLE "shipping_methods"
  ADD COLUMN IF NOT EXISTS "default_driver_user_id" INTEGER;
ALTER TABLE "shipping_methods"
  ADD COLUMN IF NOT EXISTS "default_carrier_supplier_id" INTEGER;
ALTER TABLE "shipping_methods"
  ADD COLUMN IF NOT EXISTS "cost_settlement_timing" "cost_settlement_timing_enum" DEFAULT 'immediate_on_close';

-- 3. Foreign keys opcionales (guardadas para idempotencia).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shipping_methods_default_vehicle_id_fkey'
  ) THEN
    ALTER TABLE "shipping_methods"
      ADD CONSTRAINT "shipping_methods_default_vehicle_id_fkey"
      FOREIGN KEY ("default_vehicle_id") REFERENCES "vehicles"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shipping_methods_default_driver_user_id_fkey'
  ) THEN
    ALTER TABLE "shipping_methods"
      ADD CONSTRAINT "shipping_methods_default_driver_user_id_fkey"
      FOREIGN KEY ("default_driver_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shipping_methods_default_carrier_supplier_id_fkey'
  ) THEN
    ALTER TABLE "shipping_methods"
      ADD CONSTRAINT "shipping_methods_default_carrier_supplier_id_fkey"
      FOREIGN KEY ("default_carrier_supplier_id") REFERENCES "suppliers"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;