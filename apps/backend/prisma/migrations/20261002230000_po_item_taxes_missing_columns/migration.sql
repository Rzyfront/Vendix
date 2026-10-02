-- Correctiva: 5 columnas QUI-855 v2 faltantes en purchase_order_item_taxes.
--
-- La 20260923010000 creo la tabla SIN calc_mode/fixed_amount_per_unit/
-- base_mode/sequence/amount_override. La 20260930000000 la reemplazo con
-- CREATE TABLE IF NOT EXISTS, asi que en las DBs que ya habian aplicado la
-- 0923 las columnas nunca aterrizaron (pero la migracion quedo marcada
-- aplicada). El receive hace SELECT * con include de item_taxes y revienta
-- con 500: The column `(not available)` does not exist.
--
-- DATA IMPACT:
-- Tables affected: purchase_order_item_taxes
-- Expected row changes: none (ADD COLUMN; los DEFAULT rellenan filas existentes)
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: ADD COLUMN IF NOT EXISTS + CHECK constraints con guarda
-- Approval: 500 en POST /api/store/dispatch-notes/:id/receive (local)

ALTER TABLE "purchase_order_item_taxes" ADD COLUMN IF NOT EXISTS "calc_mode" VARCHAR(20) NOT NULL DEFAULT 'percent';
ALTER TABLE "purchase_order_item_taxes" ADD COLUMN IF NOT EXISTS "fixed_amount_per_unit" DECIMAL(12, 2);
ALTER TABLE "purchase_order_item_taxes" ADD COLUMN IF NOT EXISTS "base_mode" VARCHAR(20) NOT NULL DEFAULT 'net';
ALTER TABLE "purchase_order_item_taxes" ADD COLUMN IF NOT EXISTS "sequence" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "purchase_order_item_taxes" ADD COLUMN IF NOT EXISTS "amount_override" DECIMAL(12, 2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_item_taxes_calc_mode_check') THEN
    ALTER TABLE "purchase_order_item_taxes" ADD CONSTRAINT "purchase_order_item_taxes_calc_mode_check" CHECK ("calc_mode" IN ('percent', 'fixed_per_unit'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_item_taxes_base_mode_check') THEN
    ALTER TABLE "purchase_order_item_taxes" ADD CONSTRAINT "purchase_order_item_taxes_base_mode_check" CHECK ("base_mode" IN ('net', 'net_plus_prior'));
  END IF;
END $$;
