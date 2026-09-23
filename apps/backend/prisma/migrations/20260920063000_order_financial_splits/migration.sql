-- DATA IMPACT:
-- Tables affected: orders, payments, invoices, invoice_items; four NEW financial snapshot tables.
-- Existing row changes: none. Nullable foreign keys leave all historical sales unchanged.
-- Destructive operations: none; no business-parent ON DELETE CASCADE.
-- Idempotency: IF NOT EXISTS DDL, catalog-guarded constraints, replaceable functions.
-- Approval: full F-006 implementation explicitly requested in chat (2026-09-20).
-- Financial rows are not physical orders/items and do not count as additional sales/stock.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "active_financial_split_id" INTEGER;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "financial_account_id" INTEGER,
ADD COLUMN IF NOT EXISTS "financial_effects_recorded_at" TIMESTAMP(6),
ADD COLUMN IF NOT EXISTS "financial_idempotency_key" VARCHAR(120);

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "financial_account_id" INTEGER;

-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "financial_source_line_id" INTEGER;

-- CreateTable
CREATE TABLE IF NOT EXISTS "order_financial_splits" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "source_order_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "mode" VARCHAR(10) NOT NULL,
    "state" VARCHAR(12) NOT NULL DEFAULT 'active',
    "source_version" VARCHAR(64) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "original_total" DECIMAL(12,2) NOT NULL,
    "paid_total_snapshot" DECIMAL(12,2) NOT NULL,
    "remaining_total" DECIMAL(12,2) NOT NULL,
    "original_payment_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "order_financial_splits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "order_financial_accounts" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "split_id" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "state" VARCHAR(12) NOT NULL DEFAULT 'active',
    "label" VARCHAR(100) NOT NULL,
    "customer_id" INTEGER,
    "customer_alias" VARCHAR(100),
    "subtotal_amount" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL,
    "shipping_cost" DECIMAL(12,2) NOT NULL,
    "tip_amount" DECIMAL(12,2) NOT NULL,
    "grand_total" DECIMAL(12,2) NOT NULL,
    "paid_snapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "order_financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "order_financial_lines" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "source_order_item_id" INTEGER,
    "kind" VARCHAR(12) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "source_snapshot" JSONB NOT NULL,
    "subtotal_amount" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "order_financial_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "order_financial_line_taxes" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "line_id" INTEGER NOT NULL,
    "tax_rate_id" INTEGER,
    "tax_name" VARCHAR(100) NOT NULL,
    "tax_rate" DECIMAL(6,5) NOT NULL,
    "tax_type" "tax_type_enum",
    "tax_amount" DECIMAL(12,2) NOT NULL,
    "is_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "is_compound" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "order_financial_line_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_financial_splits_store_id_source_order_id_state_idx" ON "order_financial_splits"("store_id", "source_order_id", "state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_financial_splits_created_by_idx" ON "order_financial_splits"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "order_financial_splits_store_id_idempotency_key_key" ON "order_financial_splits"("store_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "order_financial_splits_source_order_id_version_key" ON "order_financial_splits"("source_order_id", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_financial_accounts_store_id_split_id_idx" ON "order_financial_accounts"("store_id", "split_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_financial_accounts_customer_id_idx" ON "order_financial_accounts"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "order_financial_accounts_split_id_ordinal_key" ON "order_financial_accounts"("split_id", "ordinal");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_financial_lines_store_id_account_id_idx" ON "order_financial_lines"("store_id", "account_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_financial_lines_source_order_item_id_idx" ON "order_financial_lines"("source_order_item_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_financial_line_taxes_store_id_line_id_idx" ON "order_financial_line_taxes"("store_id", "line_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "orders_active_financial_split_id_key" ON "orders"("active_financial_split_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "payments_financial_idempotency_key_key" ON "payments"("financial_idempotency_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payments_financial_account_id_idx" ON "payments"("financial_account_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoices_financial_account_id_idx" ON "invoices"("financial_account_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoice_items_financial_source_line_id_idx" ON "invoice_items"("financial_source_line_id");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_active_financial_split_id_fkey' AND conrelid = '"orders"'::regclass) THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_active_financial_split_id_fkey" FOREIGN KEY ("active_financial_split_id") REFERENCES "order_financial_splits"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_financial_account_id_fkey' AND conrelid = '"payments"'::regclass) THEN
    ALTER TABLE "payments" ADD CONSTRAINT "payments_financial_account_id_fkey" FOREIGN KEY ("financial_account_id") REFERENCES "order_financial_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_financial_account_id_fkey' AND conrelid = '"invoices"'::regclass) THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_financial_account_id_fkey" FOREIGN KEY ("financial_account_id") REFERENCES "order_financial_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_financial_source_line_id_fkey' AND conrelid = '"invoice_items"'::regclass) THEN
    ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_financial_source_line_id_fkey" FOREIGN KEY ("financial_source_line_id") REFERENCES "order_financial_lines"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_financial_splits_source_order_id_fkey' AND conrelid = '"order_financial_splits"'::regclass) THEN
    ALTER TABLE "order_financial_splits" ADD CONSTRAINT "order_financial_splits_source_order_id_fkey" FOREIGN KEY ("source_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_financial_splits_store_id_fkey' AND conrelid = '"order_financial_splits"'::regclass) THEN
    ALTER TABLE "order_financial_splits" ADD CONSTRAINT "order_financial_splits_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_financial_splits_created_by_fkey' AND conrelid = '"order_financial_splits"'::regclass) THEN
    ALTER TABLE "order_financial_splits" ADD CONSTRAINT "order_financial_splits_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_financial_accounts_split_id_fkey' AND conrelid = '"order_financial_accounts"'::regclass) THEN
    ALTER TABLE "order_financial_accounts" ADD CONSTRAINT "order_financial_accounts_split_id_fkey" FOREIGN KEY ("split_id") REFERENCES "order_financial_splits"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_financial_accounts_store_id_fkey' AND conrelid = '"order_financial_accounts"'::regclass) THEN
    ALTER TABLE "order_financial_accounts" ADD CONSTRAINT "order_financial_accounts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_financial_accounts_customer_id_fkey' AND conrelid = '"order_financial_accounts"'::regclass) THEN
    ALTER TABLE "order_financial_accounts" ADD CONSTRAINT "order_financial_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_financial_lines_account_id_fkey' AND conrelid = '"order_financial_lines"'::regclass) THEN
    ALTER TABLE "order_financial_lines" ADD CONSTRAINT "order_financial_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "order_financial_accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_financial_lines_source_order_item_id_fkey' AND conrelid = '"order_financial_lines"'::regclass) THEN
    ALTER TABLE "order_financial_lines" ADD CONSTRAINT "order_financial_lines_source_order_item_id_fkey" FOREIGN KEY ("source_order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_financial_lines_store_id_fkey' AND conrelid = '"order_financial_lines"'::regclass) THEN
    ALTER TABLE "order_financial_lines" ADD CONSTRAINT "order_financial_lines_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_financial_line_taxes_line_id_fkey' AND conrelid = '"order_financial_line_taxes"'::regclass) THEN
    ALTER TABLE "order_financial_line_taxes" ADD CONSTRAINT "order_financial_line_taxes_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "order_financial_lines"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_financial_line_taxes_store_id_fkey' AND conrelid = '"order_financial_line_taxes"'::regclass) THEN
    ALTER TABLE "order_financial_line_taxes" ADD CONSTRAINT "order_financial_line_taxes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- Financial invariants are persistent: older endpoints cannot bypass the ledger.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_split_totals_check') THEN
    ALTER TABLE order_financial_splits ADD CONSTRAINT financial_split_totals_check CHECK (
      mode IN ('equal','custom','items') AND state IN ('active','cancelled') AND version > 0
      AND original_total > 0 AND paid_total_snapshot >= 0 AND remaining_total > 0
      AND original_total = paid_total_snapshot + remaining_total);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_account_totals_check') THEN
    ALTER TABLE order_financial_accounts ADD CONSTRAINT financial_account_totals_check CHECK (
      role IN ('paid_original','payable') AND state IN ('active','cancelled')
      AND subtotal_amount >= 0 AND discount_amount >= 0 AND discount_amount <= subtotal_amount
      AND tax_amount >= 0 AND shipping_cost >= 0 AND tip_amount >= 0 AND grand_total > 0
      AND grand_total = subtotal_amount - discount_amount + tax_amount + shipping_cost + tip_amount
      AND ((role = 'paid_original' AND paid_snapshot = grand_total) OR (role = 'payable' AND paid_snapshot = 0))
      AND NOT (customer_id IS NOT NULL AND customer_alias IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_line_totals_check') THEN
    ALTER TABLE order_financial_lines ADD CONSTRAINT financial_line_totals_check CHECK (
      kind IN ('item','shipping','tip') AND subtotal_amount >= 0 AND discount_amount >= 0
      AND discount_amount <= subtotal_amount AND tax_amount >= 0
      AND total_amount = subtotal_amount - discount_amount + tax_amount);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_financial_source_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE split_row order_financial_splits%ROWTYPE; assigned NUMERIC;
BEGIN
  IF OLD.active_financial_split_id IS NOT NULL AND NEW.state IS DISTINCT FROM OLD.state AND NEW.state IN ('cancelled','refunded') THEN
    RAISE EXCEPTION 'FINANCIAL_SPLIT_LOCKED: cancela las cuentas antes de anular la orden' USING ERRCODE = '23514';
  END IF;
  IF OLD.active_financial_split_id IS NOT NULL AND
      (NEW.subtotal_amount, NEW.discount_amount, NEW.tax_amount, NEW.shipping_cost,
       NEW.tip_amount, NEW.grand_total, NEW.customer_id, NEW.customer_alias, NEW.currency)
      IS DISTINCT FROM
      (OLD.subtotal_amount, OLD.discount_amount, OLD.tax_amount, OLD.shipping_cost,
       OLD.tip_amount, OLD.grand_total, OLD.customer_id, OLD.customer_alias, OLD.currency) THEN
    RAISE EXCEPTION 'FINANCIAL_SPLIT_LOCKED: modifica las cuentas, no la economía de la orden original' USING ERRCODE = '23514';
  END IF;
  IF NEW.active_financial_split_id IS NOT NULL AND NEW.active_financial_split_id IS DISTINCT FROM OLD.active_financial_split_id THEN
    SELECT * INTO split_row FROM order_financial_splits WHERE id = NEW.active_financial_split_id;
    IF split_row.source_order_id <> NEW.id OR split_row.store_id <> NEW.store_id OR split_row.state <> 'active'
       OR split_row.original_total <> NEW.grand_total THEN
      RAISE EXCEPTION 'FINANCIAL_SPLIT_INVALID_SOURCE' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(SUM(grand_total),0) INTO assigned FROM order_financial_accounts
      WHERE split_id = split_row.id AND store_id = NEW.store_id AND role = 'payable' AND state = 'active';
    IF assigned <> split_row.remaining_total THEN
      RAISE EXCEPTION 'FINANCIAL_SPLIT_UNBALANCED' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER financial_source_snapshot_guard BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION enforce_financial_source_snapshot();

CREATE OR REPLACE FUNCTION enforce_financial_item_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id INTEGER; split_id INTEGER;
BEGIN
  source_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.order_id ELSE OLD.order_id END;
  SELECT active_financial_split_id INTO split_id FROM orders WHERE id = source_id FOR UPDATE;
  IF split_id IS NOT NULL THEN
    IF TG_OP <> 'UPDATE' THEN
      RAISE EXCEPTION 'FINANCIAL_SPLIT_LOCKED: las líneas físicas ya tienen reparto financiero' USING ERRCODE = '23514';
    END IF;
    IF (NEW.order_id, NEW.product_id, NEW.product_variant_id, NEW.quantity, NEW.unit_price,
        NEW.total_price, NEW.tax_amount_item, NEW.cancelled_at, NEW.weight, NEW.price_unit_quantity)
       IS DISTINCT FROM
       (OLD.order_id, OLD.product_id, OLD.product_variant_id, OLD.quantity, OLD.unit_price,
        OLD.total_price, OLD.tax_amount_item, OLD.cancelled_at, OLD.weight, OLD.price_unit_quantity) THEN
      RAISE EXCEPTION 'FINANCIAL_SPLIT_LOCKED: cancela el reparto antes de editar importes o cantidades' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER financial_item_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION enforce_financial_item_snapshot();

CREATE OR REPLACE FUNCTION enforce_financial_payment_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_row orders%ROWTYPE; account_row order_financial_accounts%ROWTYPE; used NUMERIC;
BEGIN
  -- Consistent lock order with split/confirm/cancel: original order first.
  SELECT * INTO source_row FROM orders WHERE id = NEW.order_id FOR UPDATE;
  IF NEW.financial_account_id IS NULL THEN
    IF source_row.active_financial_split_id IS NOT NULL AND (TG_OP = 'INSERT' OR (NEW.amount, NEW.state, NEW.order_id, NEW.customer_id) IS DISTINCT FROM (OLD.amount, OLD.state, OLD.order_id, OLD.customer_id)) THEN
      RAISE EXCEPTION 'FINANCIAL_SPLIT_ACCOUNT_REQUIRED: cobra cada cuenta por separado' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO account_row FROM order_financial_accounts WHERE id = NEW.financial_account_id;
  IF account_row.id IS NULL OR account_row.store_id <> source_row.store_id
     OR account_row.split_id IS DISTINCT FROM source_row.active_financial_split_id
     OR account_row.role <> 'payable' OR account_row.state <> 'active'
     OR NEW.customer_id IS DISTINCT FROM account_row.customer_id THEN
    RAISE EXCEPTION 'FINANCIAL_SPLIT_INVALID_ACCOUNT' USING ERRCODE = '23514';
  END IF;
  IF NEW.state IN ('pending','authorized','succeeded','captured') THEN
    SELECT COALESCE(SUM(amount),0) INTO used FROM payments
      WHERE financial_account_id = NEW.financial_account_id AND id <> NEW.id
        AND state IN ('pending','authorized','succeeded','captured');
    IF NEW.amount <= 0 OR NEW.amount + used > account_row.grand_total THEN
      RAISE EXCEPTION 'FINANCIAL_SPLIT_OVERPAYMENT' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER financial_payment_budget_guard BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION enforce_financial_payment_budget();

-- A draft also claims an account; a retry must return it instead of issuing twice.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_financial_account_active_uq ON invoices(financial_account_id)
  WHERE financial_account_id IS NOT NULL AND invoice_type = 'sales_invoice' AND status NOT IN ('cancelled','voided');
CREATE OR REPLACE FUNCTION enforce_financial_invoice_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_row orders%ROWTYPE; account_row order_financial_accounts%ROWTYPE;
BEGIN
  IF NEW.order_id IS NULL OR NEW.invoice_type <> 'sales_invoice' THEN RETURN NEW; END IF;
  SELECT * INTO source_row FROM orders WHERE id = NEW.order_id FOR UPDATE;
  IF source_row.active_financial_split_id IS NOT NULL AND NEW.financial_account_id IS NULL THEN
    RAISE EXCEPTION 'FINANCIAL_SPLIT_ACCOUNT_REQUIRED: factura cada cuenta por separado' USING ERRCODE = '23514';
  END IF;
  IF NEW.financial_account_id IS NOT NULL THEN
    SELECT * INTO account_row FROM order_financial_accounts WHERE id = NEW.financial_account_id;
    IF account_row.store_id <> NEW.store_id OR account_row.split_id IS DISTINCT FROM source_row.active_financial_split_id
       OR account_row.state <> 'active' OR account_row.customer_id IS DISTINCT FROM NEW.customer_id THEN
      RAISE EXCEPTION 'FINANCIAL_SPLIT_INVALID_INVOICE' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER financial_invoice_source_guard BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION enforce_financial_invoice_source();
