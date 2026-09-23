-- DATA IMPACT:
-- Tables affected: shipping_rates (+1 nullable column), orders (+5 columns).
-- Existing row changes: none. New columns are nullable, except
--   orders.shipping_tax_amount, which is NOT NULL DEFAULT 0 (metadata-only
--   default on PG >= 11: no table rewrite, historical orders read 0 = no tax).
-- Destructive operations: none. No DROP, no UPDATE/DELETE, no CASCADE.
-- FK/cascade risk: both new FKs are ON DELETE RESTRICT (a tax category / tax
--   rate in use cannot be deleted silently).
-- Idempotency: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS and FKs
--   guarded by pg_constraint lookups inside DO $$ blocks.
-- Approval: optional per-rate shipping tax approved by the owner in chat (2026-09-22).

-- Impuesto opcional por tarifa de envío (null = sin impuesto).
ALTER TABLE "shipping_rates" ADD COLUMN IF NOT EXISTS "tax_category_id" INTEGER;

-- Copia congelada del impuesto del envío en la orden.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipping_tax_rate_id" INTEGER;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipping_tax_name" VARCHAR(100);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipping_tax_type" "tax_type_enum";
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipping_tax_rate" DECIMAL(6,5);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipping_tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "shipping_rates_tax_category_id_idx" ON "shipping_rates"("tax_category_id");
CREATE INDEX IF NOT EXISTS "orders_shipping_tax_rate_id_idx" ON "orders"("shipping_tax_rate_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shipping_rates_tax_category_id_fkey'
  ) THEN
    ALTER TABLE "shipping_rates"
      ADD CONSTRAINT "shipping_rates_tax_category_id_fkey"
      FOREIGN KEY ("tax_category_id") REFERENCES "tax_categories"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_shipping_tax_rate_id_fkey'
  ) THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_shipping_tax_rate_id_fkey"
      FOREIGN KEY ("shipping_tax_rate_id") REFERENCES "tax_rates"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
