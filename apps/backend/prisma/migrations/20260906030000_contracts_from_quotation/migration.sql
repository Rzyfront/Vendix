-- C.1 — Ficha del contrato desde cotizacion aceptada (ADR-03, ADR-04,
-- DB-04, FB-06, ERR-05). Tabla nueva `contracts` + valor `contracted` en
-- `quotation_status_enum`. `quotation_id` UNIQUE es la llave de
-- idempotencia: un contrato por cotizacion (el servicio traduce el choque
-- a 409 QUOTE_CONTRACT_001).
--
-- DATA IMPACT:
-- Tables affected:
--   · contracts               — CREADA vacía
--   · quotation_status_enum   — 1 valor AGREGADO (`contracted`), sin filas
--     reescritas (ninguna cotizacion existente lee `contracted`)
-- Expected row changes: 0 filas leídas, 0 filas mutadas. `contracts` nace
--   vacía; el enum agregado no toca valores ya almacenados.
-- Destructive operations: NINGUNA. Sin DROP, sin TRUNCATE, sin CASCADE, sin
--   DELETE, sin UPDATE.
-- FK/cascade risk: ninguno nuevo en escritura. Toda FK de `contracts` es
--   ON DELETE RESTRICT: borrar tienda/org/cliente/cotizacion con contrato
--   se bloquea en vez de arrastrar historia.
-- Idempotency: ADD VALUE con IF NOT EXISTS; CREATE TABLE / INDEX con
--   IF NOT EXISTS; ADD CONSTRAINT dentro de DO guardado por pg_constraint;
--   ADD VALUE vive en esta migracion sin USAR el valor (el servicio lo
--   escribe en tiempo de ejecucion, fuera de esta transaccion).
-- Approval: CP-quotation-contract-aiu paso C.1
-- Rollback: revertir antes de datos nuevos; con uso, migracion compensa
--   (ver Data Integrity Plan del plan)

-- ---------------------------------------------------------------------------
-- 1. Estado `contracted`: `accepted->contracted` marca contrato creado
-- (ADR-04). `accepted->converted` queda reservado a venta.
-- ---------------------------------------------------------------------------
ALTER TYPE "quotation_status_enum" ADD VALUE IF NOT EXISTS 'contracted';

-- ---------------------------------------------------------------------------
-- 2. Tabla `contracts`: ficha con snapshot AIU congelado (ADR-03).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "contracts" (
    "id"              SERIAL       NOT NULL,
    "organization_id" INTEGER      NOT NULL,
    "store_id"        INTEGER      NOT NULL,
    "quotation_id"    INTEGER      NOT NULL,
    "contract_number" VARCHAR(50)  NOT NULL,
    "customer_id"     INTEGER,
    "status"          VARCHAR(20)  NOT NULL DEFAULT 'draft',
    "subtotal_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "tax_amount"      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "grand_total"     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "snapshot"        JSONB        NOT NULL,
    "profile_id"      INTEGER,
    "profile_version" INTEGER,
    "notes"           TEXT,
    "created_by"      INTEGER,
    "created_at"      TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 3. Unicidad: un contrato por cotizacion + numero propio por tienda.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "contracts_quotation_id_key"
  ON "contracts"("quotation_id");

CREATE UNIQUE INDEX IF NOT EXISTS "contracts_store_number_uq"
  ON "contracts"("store_id", "contract_number");

CREATE INDEX IF NOT EXISTS "contracts_store_number_idx"
  ON "contracts"("store_id", "contract_number");
CREATE INDEX IF NOT EXISTS "contracts_store_status_idx"
  ON "contracts"("store_id", "status");
CREATE INDEX IF NOT EXISTS "contracts_customer_idx"
  ON "contracts"("customer_id");

-- ---------------------------------------------------------------------------
-- 4. FKs, guardadas por catalogo para ser reejecutables. Todas RESTRICT:
-- borrar con contrato referenciado se bloquea en vez de arrastrar.
-- `profile_id`/`profile_version` NO llevan FK a proposito: son
-- procedencia del snapshot (ADR-03), y la fuente de verdad es `snapshot`.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_organization_id_fkey') THEN
    ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_store_id_fkey') THEN
    ALTER TABLE "contracts" ADD CONSTRAINT "contracts_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_quotation_id_fkey') THEN
    ALTER TABLE "contracts" ADD CONSTRAINT "contracts_quotation_id_fkey"
      FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_customer_id_fkey') THEN
    ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_created_by_fkey') THEN
    ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
