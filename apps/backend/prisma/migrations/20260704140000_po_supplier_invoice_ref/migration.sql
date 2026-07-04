-- DATA IMPACT:
-- Tables affected: purchase_orders (ADD COLUMN only)
-- Expected row changes: 0 (additive nullable columns, no row mutation)
-- Destructive operations: none
-- FK/cascade risk: none (plain scalar columns, no FK)
-- Idempotency: guarded by ADD COLUMN IF NOT EXISTS
-- Approval: F2 IVA lifecycle plan (step 9) — additive supplier-invoice reference
--
-- F2 IVA lifecycle: supplier's own invoice reference on the purchase order.
-- `supplier_invoice_number` is used as the `invoice_number` of the fiscal
-- document (purchase_invoice / support_document) materialized to recognize the
-- deductible VAT (240804). `supplier_invoice_date` drives that document's
-- issue_date so it lands in the correct declaration period. Both nullable:
-- when absent, recognition falls back to `purchase_orders.order_number`.

ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "supplier_invoice_number" VARCHAR(50);
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "supplier_invoice_date" DATE;
