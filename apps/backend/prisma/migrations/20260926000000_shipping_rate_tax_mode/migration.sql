-- DATA IMPACT:
-- Tables affected: shipping_rates (+1 NOT NULL column with default), orders (+1 nullable column).
-- Existing row changes: ninguna fila mutada. New columns only:
--   shipping_rates.tax_is_inclusive BOOLEAN NOT NULL DEFAULT true (metadata-only
--   default on PG >= 11: no table rewrite, existing rates read true = incluido).
--   orders.shipping_tax_is_inclusive BOOLEAN NULL (null = historico o sin impuesto).
-- Destructive operations: none. No DROP, no UPDATE/DELETE, no CASCADE.
-- FK/cascade risk: none (no FKs added).
-- Idempotency: ADD COLUMN IF NOT EXISTS; re-applying this file is a no-op.
-- Approval: plan shipping-rate-tax-mode-and-invoicing-fixes paso 10 (lote C).

-- Modo del impuesto por tarifa: true = incluido en el precio de tarifa
-- (default; filas existentes quedan incluidas), false = agregado encima.
ALTER TABLE "shipping_rates" ADD COLUMN IF NOT EXISTS "tax_is_inclusive" BOOLEAN NOT NULL DEFAULT true;

-- Modo congelado al vender: null = historico o sin impuesto.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipping_tax_is_inclusive" BOOLEAN;
