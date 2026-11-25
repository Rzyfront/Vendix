-- QUI-1061 — Cuentas bancarias según el scope fiscal de la organización.
--
-- DATA IMPACT: ninguno. No se borra ni se modifica ninguna fila.
--   - bank_accounts: columna nueva `available_in_all_stores` (DEFAULT true).
--     Las cuentas de organización existentes (`store_id` NULL) quedan
--     disponibles en todas las tiendas, que es exactamente lo que hacían hoy.
--   - bank_account_stores: tabla nueva y vacía (asignación de cuentas de
--     organización a tiendas específicas).
--   - bank_transactions: columna nullable `store_id` para registrar la tienda
--     de origen de cada movimiento y permitir filtrar por sucursal.
--   - Índices: el único `(organization_id, account_number)` se reemplaza por
--     `(organization_id, store_id, account_number)` para cuentas de tienda y un
--     único parcial `(organization_id, account_number) WHERE store_id IS NULL`
--     para cuentas de organización. Ambos son MÁS laxos que el anterior, así
--     que todas las filas actuales los cumplen; se crean ANTES de soltar el
--     viejo para que nunca haya una ventana sin unicidad.
-- Idempotente: todo con IF NOT EXISTS / IF EXISTS / guardas en pg_constraint.

-- 1. Disponibilidad de cuentas de organización.
ALTER TABLE "bank_accounts"
  ADD COLUMN IF NOT EXISTS "available_in_all_stores" BOOLEAN NOT NULL DEFAULT true;

-- 2. Asignación de cuentas de organización a tiendas.
CREATE TABLE IF NOT EXISTS "bank_account_stores" (
  "id" SERIAL NOT NULL,
  "bank_account_id" INTEGER NOT NULL,
  "store_id" INTEGER NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bank_account_stores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bank_account_stores_bank_account_id_store_id_key"
  ON "bank_account_stores"("bank_account_id", "store_id");
CREATE INDEX IF NOT EXISTS "bank_account_stores_organization_id_store_id_idx"
  ON "bank_account_stores"("organization_id", "store_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_account_stores_bank_account_id_fkey') THEN
    ALTER TABLE "bank_account_stores"
      ADD CONSTRAINT "bank_account_stores_bank_account_id_fkey"
      FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_account_stores_store_id_fkey') THEN
    ALTER TABLE "bank_account_stores"
      ADD CONSTRAINT "bank_account_stores_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_account_stores_organization_id_fkey') THEN
    ALTER TABLE "bank_account_stores"
      ADD CONSTRAINT "bank_account_stores_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 3. Unicidad nueva (antes de soltar la vieja).
CREATE UNIQUE INDEX IF NOT EXISTS "bank_accounts_organization_id_store_id_account_number_key"
  ON "bank_accounts"("organization_id", "store_id", "account_number");
CREATE UNIQUE INDEX IF NOT EXISTS "bank_accounts_org_account_number_org_level_key"
  ON "bank_accounts"("organization_id", "account_number")
  WHERE "store_id" IS NULL;

-- 4. Se suelta la unicidad por organización (era un índice, no un constraint).
DROP INDEX IF EXISTS "bank_accounts_organization_id_account_number_key";

-- 5. Tienda de origen en movimientos bancarios (nullable, sin tocar filas previas).
ALTER TABLE "bank_transactions"
  ADD COLUMN IF NOT EXISTS "store_id" INTEGER;

CREATE INDEX IF NOT EXISTS "bank_transactions_bank_account_id_store_id_idx"
  ON "bank_transactions"("bank_account_id", "store_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_transactions_store_id_fkey') THEN
    ALTER TABLE "bank_transactions"
      ADD CONSTRAINT "bank_transactions_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
