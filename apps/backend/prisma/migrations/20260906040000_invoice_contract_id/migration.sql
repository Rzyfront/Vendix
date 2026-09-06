-- D.1 — Factura AIU precargada desde contrato (ADR-03, DB-05, FB-08,
-- ERR-07). Columna nueva `invoices.contract_id` (nullable) + FK a
-- `contracts` + indice unico PARCIAL "una factura activa por contrato".
--
-- DATA IMPACT:
-- Tables affected:
--   · invoices — 1 columna AGREGADA (`contract_id`, nullable, sin DEFAULT)
-- Expected row changes: 0 filas leidas, 0 filas mutadas. Toda factura
--   existente queda con `contract_id = NULL` (sigue facturando ordenes o
--   captura manual, intacta) y el indice parcial no la cuenta.
-- Destructive operations: NINGUNA. Sin DROP, sin TRUNCATE, sin CASCADE, sin
--   DELETE, sin UPDATE, sin backfill (NULL es el estado correcto del
--   historico: esas facturas no nacieron de un contrato).
-- FK/cascade risk: la FK nueva es ON DELETE RESTRICT: borrar un contrato con
--   factura se bloquea en vez de arrastrar historia fiscal.
-- Idempotency: ADD COLUMN con IF NOT EXISTS (DO guardado por
--   information_schema); FK dentro de DO guardado por pg_constraint; indice
--   con IF NOT EXISTS. Reejecutable.
-- Approval: CP-quotation-contract-aiu paso D.1
-- Rollback: revertir antes de datos nuevos; con uso, migracion compensa
--   (ver Data Integrity Plan del plan)

-- ---------------------------------------------------------------------------
-- 1. Columna `contract_id`: el contrato que origina el documento (ADR-03:
-- el vinculo, no los datos — los datos viajan congelados en las columnas
-- `aiu_*` de la propia factura).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'contract_id'
  ) THEN
    ALTER TABLE "invoices" ADD COLUMN "contract_id" INTEGER;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Unicidad "un contrato, una factura" SOLO sobre facturas activas
-- (DB-05: "1 factura activa por contrato").
--
-- Por que parcial y no `@unique` en el schema: anular una factura (voided /
-- cancelled) tiene que liberar al contrato para re-facturar por la via
-- auditada; un UNIQUE total lo bloquearia para siempre. Prisma no declara
-- indices parciales, igual que no declara el CHECK "ambas o ninguna" de
-- `(profile_id, profile_version)` — vive aca, documentado en el schema.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_contract_id_active_uq"
  ON "invoices"("contract_id")
  WHERE "contract_id" IS NOT NULL
    AND "status" NOT IN ('voided', 'cancelled');

CREATE INDEX IF NOT EXISTS "invoices_contract_id_idx"
  ON "invoices"("contract_id");

-- ---------------------------------------------------------------------------
-- 3. FK a `contracts`, guardada por catalogo para ser reejecutable.
-- RESTRICT en ambas direcciones de la cadena fiscal: ni el contrato se
-- borra con factura, ni la factura arrastra al contrato.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_contract_id_fkey') THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
