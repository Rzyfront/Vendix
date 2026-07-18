-- DATA IMPACT:
-- Tables affected: vehicles (adds settlement_type enum + settlement_rate decimal),
--                  suppliers (adds supplier_category enum + 3 bank columns)
-- Expected row changes: none — additive nullable columns; enum backfill defaults are
--   applied by the column DEFAULT clause in PG during ALTER TYPE.
-- Destructive operations: none (no DROP / no CASCADE / no DELETE / no UPDATE).
-- FK/cascade risk: none — this migration adds enums and columns only; FKs are not
--   introduced here (vehicle/supplier references in dispatch_routes are added in a
--   later migration under FASE 3).
-- Idempotency: guarded by IF NOT EXISTS (columns), DO $$ blocks (enum values +
--   column defaults), and a pre-check on pg_type/pg_enum.
-- Approval: Plan Despacho Economía (FASE 1) — modelo de costo del ejecutor.

-- =====================================================================
-- 1. settlement_type_enum + settlement_status_enum was already present.
--    Add the new shared enum used by vehicles and shipping_methods.
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'settlement_type_enum') THEN
    CREATE TYPE "settlement_type_enum" AS ENUM ('none', 'per_delivery', 'per_route');
  END IF;
END $$;

-- 2. Add the columns to vehicles.
ALTER TABLE "vehicles"
  ADD COLUMN IF NOT EXISTS "settlement_type" "settlement_type_enum" NOT NULL DEFAULT 'none';
ALTER TABLE "vehicles"
  ADD COLUMN IF NOT EXISTS "settlement_rate" DECIMAL(12, 2);

-- =====================================================================
-- 3. supplier_category_enum — used by carriers (FASE 1 paso 7 + FASE 5).
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'supplier_category_enum') THEN
    CREATE TYPE "supplier_category_enum" AS ENUM ('goods', 'carrier', 'service');
  END IF;
END $$;

-- 4. Category column on suppliers — backfill defaults to 'goods' (legacy behavior).
ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "supplier_category" "supplier_category_enum" NOT NULL DEFAULT 'goods';

-- 5. Bank columns on suppliers — fix the latent runtime error in
--    ap-bank-export.service.ts:39-41 which selected these columns even
--    though they did not exist on the table.
ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "bank_name" VARCHAR(120);
ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "bank_account_number" VARCHAR(60);
ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "bank_account_type" VARCHAR(20);

-- 6. Index that prisma @@index([organization_id, supplier_category]) would emit.
CREATE INDEX IF NOT EXISTS "suppliers_organization_id_supplier_category_idx"
  ON "suppliers"("organization_id", "supplier_category");