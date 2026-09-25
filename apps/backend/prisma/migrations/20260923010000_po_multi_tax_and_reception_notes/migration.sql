-- QUI-855: multi-tax per purchase-order line + per-line reception motive.
-- Mirrors sales `order_item_taxes` plus `taxable_amount` (per-tax base for the
-- POP summary breakdown) and `add_to_cost` (IBUA/ICUI-style taxes capitalized
-- into inventory cost instead of treated as deductible).
CREATE TABLE "purchase_order_item_taxes" (
  "id" SERIAL PRIMARY KEY,
  "purchase_order_item_id" INTEGER NOT NULL REFERENCES "purchase_order_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "tax_rate_id" INTEGER REFERENCES "tax_rates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  "tax_name" VARCHAR(100) NOT NULL,
  "tax_rate" DECIMAL(6, 5) NOT NULL,
  "tax_type" "tax_type_enum" NOT NULL DEFAULT 'iva',
  "taxable_amount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "is_inclusive" BOOLEAN NOT NULL DEFAULT false,
  "add_to_cost" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "purchase_order_item_taxes_item_idx" ON "purchase_order_item_taxes"("purchase_order_item_id");

-- Per-line shortage/damage motive recorded at reception time.
ALTER TABLE "purchase_order_reception_items" ADD COLUMN "note" TEXT;
