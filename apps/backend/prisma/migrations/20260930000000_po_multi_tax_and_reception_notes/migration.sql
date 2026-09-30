-- QUI-855: multi-tax per purchase-order line + per-line reception motive.
-- DATA IMPACT: none (schema only, new table + nullable column)
-- Idempotent: safe to re-run (IF NOT EXISTS / guarded constraints).
--
-- Mirrors sales `order_item_taxes` plus:
--   * taxable_amount  per-tax base for the POP summary breakdown
--   * add_to_cost     IBUA/ICUI-style taxes capitalized into inventory cost
--   * calc_mode / fixed_amount_per_unit  percent vs fixed-per-unit taxes
--   * base_mode / sequence               cascading bases (net vs net_plus_prior)
--   * amount_override                    manual amount override
-- tax_rate stores a PERCENTAGE (19.0000), NULL for fixed_per_unit taxes.
--
-- NOTE on FK: same as `order_item_taxes` (ON DELETE RESTRICT on the line).
-- No CASCADE: the service deletes the tax rows explicitly before deleting a
-- line (update of a draft, remove of a PO). tax_rate_id stays RESTRICT.

CREATE TABLE IF NOT EXISTS "purchase_order_item_taxes" (
  "id" SERIAL PRIMARY KEY,
  "purchase_order_item_id" INTEGER NOT NULL,
  "tax_rate_id" INTEGER,
  "tax_name" VARCHAR(100) NOT NULL,
  "tax_rate" DECIMAL(7, 4),
  "tax_type" "tax_type_enum" NOT NULL DEFAULT 'iva',
  "calc_mode" VARCHAR(20) NOT NULL DEFAULT 'percent',
  "fixed_amount_per_unit" DECIMAL(12, 2),
  "base_mode" VARCHAR(20) NOT NULL DEFAULT 'net',
  "sequence" INTEGER NOT NULL DEFAULT 30,
  "taxable_amount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "amount_override" DECIMAL(12, 2),
  "is_inclusive" BOOLEAN NOT NULL DEFAULT false,
  "add_to_cost" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_order_item_taxes_calc_mode_check" CHECK ("calc_mode" IN ('percent', 'fixed_per_unit')),
  CONSTRAINT "purchase_order_item_taxes_base_mode_check" CHECK ("base_mode" IN ('net', 'net_plus_prior'))
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_item_taxes_purchase_order_item_id_fkey') THEN
    ALTER TABLE "purchase_order_item_taxes"
      ADD CONSTRAINT "purchase_order_item_taxes_purchase_order_item_id_fkey"
      FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_item_taxes_tax_rate_id_fkey') THEN
    ALTER TABLE "purchase_order_item_taxes"
      ADD CONSTRAINT "purchase_order_item_taxes_tax_rate_id_fkey"
      FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "purchase_order_item_taxes_purchase_order_item_id_idx"
  ON "purchase_order_item_taxes"("purchase_order_item_id");

-- Per-line shortage/damage motive recorded at reception time.
ALTER TABLE "purchase_order_reception_items" ADD COLUMN IF NOT EXISTS "note" TEXT;
