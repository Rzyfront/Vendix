-- DATA IMPACT:
-- Tables affected: new purchase_vat_contributions table; accounting_entries gets one CHECK constraint and one partial unique index.
-- Expected row changes: none; no historical rows are backfilled or modified.
-- Destructive operations: none.
-- FK/cascade risk: all new business relations use RESTRICT; no cascades.
-- Idempotency: table/index creation is guarded; constraints and foreign keys are catalog-guarded by owning table.
-- Approval: approved foundation step; no writer, auto-entry, fiscal behavior, or production deploy.

CREATE TABLE IF NOT EXISTS "purchase_vat_contributions" (
  "id" SERIAL PRIMARY KEY,
  "organization_id" INTEGER NOT NULL,
  "accounting_entity_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "purchase_order_id" INTEGER NOT NULL,
  "reception_id" INTEGER NOT NULL,
  "supplier_id" INTEGER NOT NULL,
  "supplier_tax_id_snapshot" VARCHAR(50),
  "invoice_number_snapshot" VARCHAR(100),
  "invoice_issue_date_snapshot" DATE,
  "received_document_id" INTEGER,
  "fiscal_projection_invoice_id" INTEGER,
  "accounting_entry_id" INTEGER,
  "currency" VARCHAR(3) NOT NULL,
  "net_amount" DECIMAL(15,2) NOT NULL,
  "iva_amount" DECIMAL(15,2) NOT NULL,
  "tax_groups_snapshot" JSONB NOT NULL,
  "source_effect_key" VARCHAR(160) NOT NULL,
  "payload_hash" VARCHAR(64) NOT NULL,
  "ledger_status" VARCHAR(24) NOT NULL DEFAULT 'pending',
  "fiscal_status" VARCHAR(24) NOT NULL DEFAULT 'awaiting_document',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_attempt_at" TIMESTAMP(6),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_org_fkey') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_entity_fkey') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_entity_fkey" FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_store_fkey') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_store_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_po_fkey') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_po_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_reception_fkey') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_reception_fkey" FOREIGN KEY ("reception_id") REFERENCES "purchase_order_receptions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_supplier_fkey') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_supplier_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_document_fkey') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_document_fkey" FOREIGN KEY ("received_document_id") REFERENCES "received_documents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_invoice_fkey') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_invoice_fkey" FOREIGN KEY ("fiscal_projection_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_entry_fkey') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_entry_fkey" FOREIGN KEY ("accounting_entry_id") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_amounts_nonnegative_check') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_amounts_nonnegative_check" CHECK ("net_amount" >= 0 AND "iva_amount" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_attempt_nonnegative_check') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_attempt_nonnegative_check" CHECK ("attempt_count" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_currency_check') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_payload_hash_check') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_payload_hash_check" CHECK ("payload_hash" ~ '^[0-9a-fA-F]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_ledger_status_check') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_ledger_status_check" CHECK ("ledger_status" IN ('pending', 'posted', 'failed', 'skipped'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_fiscal_status_check') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_fiscal_status_check" CHECK ("fiscal_status" IN ('awaiting_document', 'linked', 'qualified', 'superseded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_source_effect_key_check') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_source_effect_key_check" CHECK ("source_effect_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_tax_groups_array_check') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_tax_groups_array_check" CHECK (jsonb_typeof("tax_groups_snapshot") = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_entry_status_check') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_entry_status_check" CHECK (("ledger_status" = 'posted') = ("accounting_entry_id" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_vat_contributions'::regclass AND conname = 'purchase_vat_contributions_document_status_check') THEN
    ALTER TABLE "purchase_vat_contributions" ADD CONSTRAINT "purchase_vat_contributions_document_status_check" CHECK (("fiscal_status" NOT IN ('linked', 'qualified') OR "received_document_id" IS NOT NULL) AND ("fiscal_status" <> 'qualified' OR "fiscal_projection_invoice_id" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'accounting_entries'::regclass AND conname = 'accounting_entries_purchase_vat_source_ids_check') THEN
    ALTER TABLE "accounting_entries" ADD CONSTRAINT "accounting_entries_purchase_vat_source_ids_check" CHECK ("source_type" IS DISTINCT FROM 'purchase_vat_contribution' OR ("accounting_entity_id" IS NOT NULL AND "source_id" IS NOT NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_vat_contributions_accounting_entry_id_key"
  ON "purchase_vat_contributions"("accounting_entry_id");
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_vat_contributions_org_entity_effect_key"
  ON "purchase_vat_contributions"("organization_id", "accounting_entity_id", "source_effect_key");
CREATE INDEX IF NOT EXISTS "purchase_vat_contributions_org_entity_ledger_status_idx"
  ON "purchase_vat_contributions"("organization_id", "accounting_entity_id", "ledger_status");
CREATE INDEX IF NOT EXISTS "purchase_vat_contributions_document_fiscal_status_idx"
  ON "purchase_vat_contributions"("received_document_id", "fiscal_status");
CREATE INDEX IF NOT EXISTS "purchase_vat_contributions_po_reception_idx"
  ON "purchase_vat_contributions"("purchase_order_id", "reception_id");
CREATE INDEX IF NOT EXISTS "purchase_vat_contributions_projection_invoice_idx"
  ON "purchase_vat_contributions"("fiscal_projection_invoice_id");

CREATE UNIQUE INDEX IF NOT EXISTS "accounting_entries_purchase_vat_contribution_source_key"
  ON "accounting_entries"("organization_id", "accounting_entity_id", "source_type", "source_id")
  WHERE "source_type" = 'purchase_vat_contribution' AND "accounting_entity_id" IS NOT NULL AND "source_id" IS NOT NULL;
