-- DATA IMPACT:
-- Tables affected: dispatch_notes (add column shipping_cost)
-- Expected row changes: none. New NOT NULL numeric column with DEFAULT 0; all
--   existing rows are backfilled with 0 by the DEFAULT (zero rows destroyed).
-- Destructive operations: none (aditiva pura — solo ADD COLUMN)
-- FK/cascade risk: none (plain DECIMAL column, no FK, no constraint beyond NOT NULL DEFAULT)
-- Idempotency: guarded by ADD COLUMN IF NOT EXISTS (safe to re-run)
-- Approval: bug de dinero — la remisión creada desde una orden de cliente perdía
--           el flete (orders.shipping_cost). La ruta de despacho recauda
--           dispatch_notes.grand_total para el COD, así que el repartidor
--           recaudaba `orden - flete`. Esta columna persiste el flete en la
--           remisión para que grand_total incluya el flete que paga el cliente.

ALTER TABLE "dispatch_notes" ADD COLUMN IF NOT EXISTS "shipping_cost" NUMERIC(12,2) NOT NULL DEFAULT 0;
