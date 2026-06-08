-- DATA IMPACT:
--   Tables affected:
--     - invoice_items   (ADD nullable columns: applied_price_tier_name,
--                        stock_units_consumed)
--   Expected row changes:
--     - No UPDATE/DELETE of existing rows. Both columns are nullable and
--       default to NULL, so existing invoice lines keep current behavior
--       (no tier label, no packaging line) until new invoices are built
--       from orders carrying the "Empaque por tarifa" snapshot.
--   Destructive operations: none (additive only).
--   FK/cascade risk: none (no FK, CASCADE, TRUNCATE, or unscoped DELETE/UPDATE).
--   Idempotency: guarded with IF NOT EXISTS; safe to re-run / no-op when
--     already applied.
--   Approval: "Empaque por tarifa" plan — invoices must mirror the order PDF
--     by showing the applied price tier and packaging units consumed per line.

BEGIN;

-- Snapshot of the price tier applied on the source order line (human label).
ALTER TABLE "invoice_items"
  ADD COLUMN IF NOT EXISTS "applied_price_tier_name" VARCHAR(255);

-- Real stock units consumed when packaging expands the sold quantity.
ALTER TABLE "invoice_items"
  ADD COLUMN IF NOT EXISTS "stock_units_consumed" INTEGER;

COMMIT;
