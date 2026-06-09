-- DATA IMPACT:
-- Tables affected: tax_categories, order_item_taxes, invoice_taxes (add nullable tax_type column + backfill)
-- Expected row changes: every existing row gets a tax_type by name heuristic; non-classifiable rows default to 'iva'
-- Destructive operations: none (additive nullable columns; UPDATE guarded by WHERE tax_type IS NULL)
-- FK/cascade risk: none
-- Idempotency: CREATE TYPE guarded by pg_type check; ADD COLUMN IF NOT EXISTS; UPDATE only fills NULLs
-- Approval: documented in chat (Rafael, 2026-06-09 — fiscal tax typing plan)
--
-- Introduces a persisted fiscal classification (tax_type) as the single source
-- of truth that travels from the tax definition to invoices, accounting entries
-- and declarations. Backfill mirrors the existing DIAN resolveTaxCode heuristic.

-- 1. Fiscal tax type enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tax_type_enum') THEN
    CREATE TYPE "tax_type_enum" AS ENUM ('iva', 'inc', 'ica', 'withholding', 'reteiva', 'reteica');
  END IF;
END $$;

-- 2. Add nullable columns (source of truth + denormalized onto tax rows)
ALTER TABLE "tax_categories"   ADD COLUMN IF NOT EXISTS "tax_type" "tax_type_enum";
ALTER TABLE "order_item_taxes" ADD COLUMN IF NOT EXISTS "tax_type" "tax_type_enum";
ALTER TABLE "invoice_taxes"    ADD COLUMN IF NOT EXISTS "tax_type" "tax_type_enum";

-- 3. Backfill by name heuristic. Order matters: reteiva/reteica before withholding,
--    ica/inc before iva. Non-classifiable rows default to 'iva' (the de-facto prior
--    behavior, where every tax was posted to 2408). A post-migration report query
--    surfaces rows defaulted to 'iva' without an 'IVA'/'VAT' token for manual review.
UPDATE "tax_categories" SET "tax_type" = (CASE
  WHEN upper(name) LIKE '%RETEIVA%' OR (upper(name) LIKE '%RETE%' AND upper(name) LIKE '%IVA%') THEN 'reteiva'
  WHEN upper(name) LIKE '%RETEICA%' OR (upper(name) LIKE '%RETE%' AND upper(name) LIKE '%ICA%') THEN 'reteica'
  WHEN upper(name) LIKE '%RETEN%' OR upper(name) LIKE '%RETEFUENTE%' OR upper(name) LIKE '%WITHHOLD%' THEN 'withholding'
  WHEN upper(name) LIKE '%ICA%' THEN 'ica'
  WHEN upper(name) LIKE '%INC%' OR upper(name) LIKE '%CONSUMO%' OR upper(name) LIKE '%IMPOCONSUMO%' THEN 'inc'
  ELSE 'iva'
END)::"tax_type_enum"
WHERE "tax_type" IS NULL;

UPDATE "order_item_taxes" SET "tax_type" = (CASE
  WHEN upper(tax_name) LIKE '%RETEIVA%' OR (upper(tax_name) LIKE '%RETE%' AND upper(tax_name) LIKE '%IVA%') THEN 'reteiva'
  WHEN upper(tax_name) LIKE '%RETEICA%' OR (upper(tax_name) LIKE '%RETE%' AND upper(tax_name) LIKE '%ICA%') THEN 'reteica'
  WHEN upper(tax_name) LIKE '%RETEN%' OR upper(tax_name) LIKE '%RETEFUENTE%' OR upper(tax_name) LIKE '%WITHHOLD%' THEN 'withholding'
  WHEN upper(tax_name) LIKE '%ICA%' THEN 'ica'
  WHEN upper(tax_name) LIKE '%INC%' OR upper(tax_name) LIKE '%CONSUMO%' OR upper(tax_name) LIKE '%IMPOCONSUMO%' THEN 'inc'
  ELSE 'iva'
END)::"tax_type_enum"
WHERE "tax_type" IS NULL;

UPDATE "invoice_taxes" SET "tax_type" = (CASE
  WHEN upper(tax_name) LIKE '%RETEIVA%' OR (upper(tax_name) LIKE '%RETE%' AND upper(tax_name) LIKE '%IVA%') THEN 'reteiva'
  WHEN upper(tax_name) LIKE '%RETEICA%' OR (upper(tax_name) LIKE '%RETE%' AND upper(tax_name) LIKE '%ICA%') THEN 'reteica'
  WHEN upper(tax_name) LIKE '%RETEN%' OR upper(tax_name) LIKE '%RETEFUENTE%' OR upper(tax_name) LIKE '%WITHHOLD%' THEN 'withholding'
  WHEN upper(tax_name) LIKE '%ICA%' THEN 'ica'
  WHEN upper(tax_name) LIKE '%INC%' OR upper(tax_name) LIKE '%CONSUMO%' OR upper(tax_name) LIKE '%IMPOCONSUMO%' THEN 'inc'
  ELSE 'iva'
END)::"tax_type_enum"
WHERE "tax_type" IS NULL;
