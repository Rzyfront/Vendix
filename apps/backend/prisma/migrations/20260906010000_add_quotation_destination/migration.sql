-- A.1 — Destino inmutable en quotations (ADR-01, DB-01, FB-01).
-- Columna `destination` + enum `quotation_destination_enum`
-- (`sale`|`contract`|`other`) con default `sale`. El destino se fija al
-- crear y jamas se edita (el bloqueo vive en `QuotationsService.update`
-- con QUOTE_DESTINATION_001); `sale` fluye a orden como hoy.
--
-- DATA IMPACT:
-- Tables affected: quotations
-- Expected row changes: 0 (columna nueva NOT NULL con DEFAULT 'sale':
--   las filas existentes leen `sale` sin backfill ni reescritura)
-- Destructive operations: none
-- FK/cascade risk: none — sin FK nuevas, sin indices nuevos, sin DROP
-- Idempotency: CREATE TYPE guardado por pg_type, ADD COLUMN con IF NOT EXISTS
-- Approval: CP-quotation-contract-aiu paso A.1
-- Rollback: revertir antes de datos nuevos; con datos, migracion compensa
--   (ver Data Integrity Plan del plan)

-- 1. Enum de destino, guardado por catalogo para ser reejecutable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quotation_destination_enum') THEN
    CREATE TYPE "quotation_destination_enum" AS ENUM ('sale', 'contract', 'other');
  END IF;
END $$;

-- 2. Columna nueva con default 'sale': cero filas existentes cambian de
-- comportamiento. Sin backfill.
ALTER TABLE "quotations"
  ADD COLUMN IF NOT EXISTS "destination" "quotation_destination_enum" NOT NULL DEFAULT 'sale';
