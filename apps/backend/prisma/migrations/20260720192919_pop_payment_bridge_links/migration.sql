-- DATA IMPACT:
-- Tables affected: purchase_order_payments (add nullable cols), ap_payments (add nullable cols),
--   purchase_order_attachments (add nullable col), + new table ap_reception_links
-- Expected row changes: none (purely additive: nullable columns w/ scalar defaults, new table, indexes, FKs)
-- Destructive operations: none (no DROP / DELETE / TRUNCATE / UPDATE of existing data)
-- FK/cascade risk: new FKs only. Nullable mirror-link FKs use ON DELETE SET NULL.
--   ap_reception_links FKs use ON DELETE CASCADE (pure junction / idempotency table, no business data).
-- Idempotency: every statement guarded (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS /
--   CREATE [UNIQUE] INDEX IF NOT EXISTS / pg_constraint existence checks for FKs).
-- Approval: additive-only; not gated by the destructive-migration rules.
-- Note: the two mirror-link columns use PARTIAL UNIQUE indexes (WHERE ... IS NOT NULL) so the
--   OC<->CxP 1:1 mirror cannot duplicate while still allowing many NULLs. Prisma cannot express a
--   partial unique in @@unique, so these indexes are declared here as raw SQL.

-- ── 1) purchase_order_payments: mirror link to ap_payments + source origin ──
ALTER TABLE "purchase_order_payments" ADD COLUMN IF NOT EXISTS "ap_payment_id" INTEGER;
ALTER TABLE "purchase_order_payments" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'po_modal';

-- ── 2) ap_payments: mirror link to purchase_order_payments + source origin ──
ALTER TABLE "ap_payments" ADD COLUMN IF NOT EXISTS "purchase_order_payment_id" INTEGER;
ALTER TABLE "ap_payments" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'ap_ui';

-- ── 5) purchase_order_attachments: optional link to a concrete payment ──
ALTER TABLE "purchase_order_attachments" ADD COLUMN IF NOT EXISTS "payment_id" INTEGER;

-- ── 4) New table ap_reception_links (AP idempotency per reception) ──
CREATE TABLE IF NOT EXISTS "ap_reception_links" (
    "id" SERIAL NOT NULL,
    "accounts_payable_id" INTEGER NOT NULL,
    "reception_id" INTEGER NOT NULL,
    "gross_amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ap_reception_links_pkey" PRIMARY KEY ("id")
);

-- ── Indexes managed 1:1 with the Prisma schema ──
-- @unique reception_id (one AP link per reception)
CREATE UNIQUE INDEX IF NOT EXISTS "ap_reception_links_reception_id_key" ON "ap_reception_links"("reception_id");
-- @@index accounts_payable_id
CREATE INDEX IF NOT EXISTS "ap_reception_links_accounts_payable_id_idx" ON "ap_reception_links"("accounts_payable_id");
-- @@index purchase_order_attachments.payment_id
CREATE INDEX IF NOT EXISTS "purchase_order_attachments_payment_id_idx" ON "purchase_order_attachments"("payment_id");

-- ── PARTIAL UNIQUE indexes for the 1:1 doc<->payment mirror (raw SQL: Prisma cannot express WHERE) ──
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_order_payments_ap_payment_id_unique"
    ON "purchase_order_payments"("ap_payment_id") WHERE "ap_payment_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "ap_payments_purchase_order_payment_id_unique"
    ON "ap_payments"("purchase_order_payment_id") WHERE "purchase_order_payment_id" IS NOT NULL;

-- ── Foreign keys (guarded via pg_constraint; ADD CONSTRAINT has no IF NOT EXISTS) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_payments_ap_payment_id_fkey') THEN
    ALTER TABLE "purchase_order_payments"
      ADD CONSTRAINT "purchase_order_payments_ap_payment_id_fkey"
      FOREIGN KEY ("ap_payment_id") REFERENCES "ap_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ap_payments_purchase_order_payment_id_fkey') THEN
    ALTER TABLE "ap_payments"
      ADD CONSTRAINT "ap_payments_purchase_order_payment_id_fkey"
      FOREIGN KEY ("purchase_order_payment_id") REFERENCES "purchase_order_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_attachments_payment_id_fkey') THEN
    ALTER TABLE "purchase_order_attachments"
      ADD CONSTRAINT "purchase_order_attachments_payment_id_fkey"
      FOREIGN KEY ("payment_id") REFERENCES "purchase_order_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ap_reception_links_accounts_payable_id_fkey') THEN
    ALTER TABLE "ap_reception_links"
      ADD CONSTRAINT "ap_reception_links_accounts_payable_id_fkey"
      FOREIGN KEY ("accounts_payable_id") REFERENCES "accounts_payable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ap_reception_links_reception_id_fkey') THEN
    ALTER TABLE "ap_reception_links"
      ADD CONSTRAINT "ap_reception_links_reception_id_fkey"
      FOREIGN KEY ("reception_id") REFERENCES "purchase_order_receptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
