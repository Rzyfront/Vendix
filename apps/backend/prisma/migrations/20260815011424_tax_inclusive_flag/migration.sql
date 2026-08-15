-- DATA IMPACT:
-- Tables affected: tax_categories, tax_rates, invoice_items, invoice_taxes
-- Columns added (4):
--   - tax_categories.is_inclusive  BOOLEAN NULL DEFAULT FALSE
--   - tax_rates.is_inclusive       BOOLEAN NULL DEFAULT FALSE
--   - invoice_items.is_inclusive   BOOLEAN NULL DEFAULT FALSE
--   - invoice_taxes.is_inclusive   BOOLEAN NULL DEFAULT FALSE
-- Expected row changes: none (all DEFAULT FALSE; historical invoices are
--   implicitly ADDITIONAL, which preserves their original total_amount)
-- Destructive operations: none (only ADD COLUMN IF NOT EXISTS, no DROP
--   COLUMN, no TRUNCATE, no CASCADE, no backfill that mutates rows)
-- FK/cascade risk: none (column additions only, no FK changes)
-- Idempotency: every ADD COLUMN is guarded by IF NOT EXISTS so the migration
--   can be replayed safely if needed
-- Approval: QUI-690 invoice-create XXL modal plan, Phase 1 Step 2; documented
--   in chat
--
-- Context: Vendix invoicing lacked a per-line flag to distinguish taxes
-- INCLUDED in `unit_price` from taxes ADDITIONAL on top. The user
-- requested explicit selection in `app-tax-selector` and the modal XXL
-- for manual invoice creation. The flag is nullable + DEFAULT FALSE so
-- legacy rows are implicitly ADDITIONAL (preserving their totals) and
-- new rows opt in via the frontend toggle. Per-line override lives on
-- `invoice_taxes.is_inclusive` and `invoice_items.is_inclusive`; the
-- catalog-level defaults live on `tax_categories.is_inclusive` and
-- `tax_rates.is_inclusive`. UBL DIAN builder
-- (`apps/backend/src/domains/store/invoicing/providers/dian-direct/xml/ubl-common.builder.ts`)
-- reads `is_inclusive` to emit `TaxInclusiveIndicator` XML attribute.

ALTER TABLE "tax_categories" ADD COLUMN IF NOT EXISTS "is_inclusive" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "tax_rates" ADD COLUMN IF NOT EXISTS "is_inclusive" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "is_inclusive" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "invoice_taxes" ADD COLUMN IF NOT EXISTS "is_inclusive" BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill safety: keep nullable behavior consistent in Prisma client. The
-- schema declares `Boolean? @default(false)` but the column is created
-- `NOT NULL DEFAULT FALSE`. The Prisma client treats NOT NULL columns
-- without explicit value as default; the `?` in the schema is for forward
-- compatibility (later changes to drop NOT NULL won't break existing code).
-- No data migration needed.
