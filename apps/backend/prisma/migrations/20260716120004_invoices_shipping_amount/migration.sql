-- DATA IMPACT:
-- Tables affected: invoices (adds shipping_amount Decimal default 0)
-- Expected row changes: none — additive nullable default column. Las facturas
--   existentes conservan subtotal/tax/total intactos (shipping_amount=0 ⇒
--   comportamiento legacy, sin línea separada en el asiento).
-- Destructive operations: none.
-- FK/cascade risk: none.
-- Idempotency: IF NOT EXISTS.
-- Approval: Plan Despacho Economía (FASE 4) — ingreso de flete separado.

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "shipping_amount" DECIMAL(12, 2) NOT NULL DEFAULT 0;