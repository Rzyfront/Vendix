-- DATA IMPACT
-- Additive only: creates persistent received-document and tax-settlement tables,
-- adds nullable/defaulted fiscal metadata columns, and creates indexes/FKs.
-- No existing rows are rewritten or deleted. All business-record foreign keys
-- use RESTRICT; this migration contains no DROP, DELETE, UPDATE, or CASCADE.

CREATE TABLE IF NOT EXISTS "received_documents" (
  "id" SERIAL NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "accounting_entity_id" INTEGER NOT NULL,
  "supplier_id" INTEGER,
  "document_type" VARCHAR(30) NOT NULL DEFAULT 'invoice',
  "source_channel" VARCHAR(30) NOT NULL DEFAULT 'manual',
  "idempotency_key" VARCHAR(160) NOT NULL,
  "issuer_tax_id" VARCHAR(50),
  "issuer_name" VARCHAR(255),
  "receiver_tax_id" VARCHAR(50),
  "receiver_name" VARCHAR(255),
  "invoice_number" VARCHAR(100),
  "document_key" VARCHAR(128),
  "source_hash" VARCHAR(64),
  "original_reference_key" VARCHAR(128),
  "original_reference_number" VARCHAR(100),
  "issue_date" DATE,
  "due_date" DATE,
  "currency" VARCHAR(10) NOT NULL DEFAULT 'COP',
  "subtotal_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "discount_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "processing_status" VARCHAR(30) NOT NULL DEFAULT 'ready',
  "validation_status" VARCHAR(30) NOT NULL DEFAULT 'pending',
  "review_status" VARCHAR(30) NOT NULL DEFAULT 'pending',
  "matching_status" VARCHAR(30) NOT NULL DEFAULT 'unlinked',
  "fiscal_status" VARCHAR(30) NOT NULL DEFAULT 'pending',
  "posting_status" VARCHAR(30) NOT NULL DEFAULT 'pending',
  "raw_payload" JSONB,
  "validation_summary" JSONB,
  "metadata" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" INTEGER,
  "reviewed_by" INTEGER,
  "reviewed_at" TIMESTAMP(6),
  "confirmed_goods_at" TIMESTAMP(6),
  "accepted_at" TIMESTAMP(6),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "received_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "received_docs_entity_idempotency_key" UNIQUE ("accounting_entity_id", "idempotency_key")
);

CREATE TABLE IF NOT EXISTS "received_document_files" (
  "id" SERIAL NOT NULL,
  "document_id" INTEGER NOT NULL,
  "file_key" VARCHAR(500) NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(150) NOT NULL,
  "file_size" INTEGER NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "role" VARCHAR(30) NOT NULL DEFAULT 'original',
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "received_document_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "received_doc_files_document_sha256_key" UNIQUE ("document_id", "sha256")
);

CREATE TABLE IF NOT EXISTS "received_document_items" (
  "id" SERIAL NOT NULL,
  "document_id" INTEGER NOT NULL,
  "line_number" INTEGER NOT NULL,
  "external_code" VARCHAR(100),
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(15,4) NOT NULL,
  "unit_code" VARCHAR(30),
  "unit_price" DECIMAL(15,6) NOT NULL,
  "discount_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "net_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "product_id" INTEGER,
  "product_variant_id" INTEGER,
  CONSTRAINT "received_document_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "received_doc_items_document_line_key" UNIQUE ("document_id", "line_number")
);

CREATE TABLE IF NOT EXISTS "received_document_taxes" (
  "id" SERIAL NOT NULL,
  "document_id" INTEGER NOT NULL,
  "item_id" INTEGER,
  "tax_type" "tax_type_enum",
  "scheme_code" VARCHAR(30),
  "tax_name" VARCHAR(100) NOT NULL,
  "rate" DECIMAL(9,5),
  "base_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "eligible_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "treatment" VARCHAR(30) NOT NULL DEFAULT 'pending',
  CONSTRAINT "received_document_taxes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "received_document_links" (
  "id" SERIAL NOT NULL,
  "document_id" INTEGER NOT NULL,
  "purchase_order_id" INTEGER,
  "reception_id" INTEGER,
  "expense_id" INTEGER,
  "invoice_id" INTEGER,
  "accounts_payable_id" INTEGER,
  "accounting_entry_id" INTEGER,
  "allocation_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "received_document_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "received_doc_links_doc_po_key" UNIQUE ("document_id", "purchase_order_id"),
  CONSTRAINT "received_doc_links_doc_reception_key" UNIQUE ("document_id", "reception_id"),
  CONSTRAINT "received_doc_links_doc_expense_key" UNIQUE ("document_id", "expense_id"),
  CONSTRAINT "received_doc_links_doc_invoice_key" UNIQUE ("document_id", "invoice_id"),
  CONSTRAINT "received_doc_links_doc_ap_key" UNIQUE ("document_id", "accounts_payable_id"),
  CONSTRAINT "received_doc_links_doc_entry_key" UNIQUE ("document_id", "accounting_entry_id"),
  CONSTRAINT "received_doc_links_one_target_check" CHECK (num_nonnulls("purchase_order_id", "reception_id", "expense_id", "invoice_id", "accounts_payable_id", "accounting_entry_id") = 1)
);

CREATE TABLE IF NOT EXISTS "received_document_events" (
  "id" SERIAL NOT NULL,
  "document_id" INTEGER NOT NULL,
  "event_type" VARCHAR(40) NOT NULL,
  "event_code" VARCHAR(3),
  "idempotency_key" VARCHAR(160) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'pending',
  "event_number" VARCHAR(100),
  "cude" VARCHAR(100),
  "request_xml" TEXT,
  "response_xml" TEXT,
  "result" JSONB,
  "actor_id" INTEGER,
  "event_date" TIMESTAMP(6),
  "confirmed_at" TIMESTAMP(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "received_document_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "received_doc_events_doc_idempotency_key" UNIQUE ("document_id", "idempotency_key")
);

CREATE TABLE IF NOT EXISTS "received_document_event_attempts" (
  "id" SERIAL NOT NULL,
  "event_id" INTEGER NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "status" VARCHAR(30) NOT NULL,
  "request_xml" TEXT,
  "response_xml" TEXT,
  "result" JSONB,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "received_document_event_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "received_doc_event_attempt_event_number_key" UNIQUE ("event_id", "attempt_number")
);

CREATE TABLE IF NOT EXISTS "document_reception_connections" (
  "id" SERIAL NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "accounting_entity_id" INTEGER NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "connection_type" VARCHAR(30) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "endpoint" VARCHAR(2048),
  "encrypted_secret" TEXT,
  "settings" JSONB,
  "cursor" TEXT,
  "poll_interval_minutes" INTEGER NOT NULL DEFAULT 15,
  "next_sync_at" TIMESTAMP(6),
  "last_synced_at" TIMESTAMP(6),
  "last_error" TEXT,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_reception_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "document_reception_runs" (
  "id" SERIAL NOT NULL,
  "connection_id" INTEGER NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'pending',
  "trigger" VARCHAR(30) NOT NULL DEFAULT 'manual',
  "idempotency_key" VARCHAR(160) NOT NULL,
  "received_count" INTEGER NOT NULL DEFAULT 0,
  "duplicate_count" INTEGER NOT NULL DEFAULT 0,
  "error_count" INTEGER NOT NULL DEFAULT 0,
  "cursor_before" TEXT,
  "cursor_after" TEXT,
  "summary" JSONB,
  "started_at" TIMESTAMP(6),
  "finished_at" TIMESTAMP(6),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_reception_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "doc_reception_runs_conn_idempotency_key" UNIQUE ("connection_id", "idempotency_key")
);

CREATE TABLE IF NOT EXISTS "fiscal_tax_credits" (
  "id" SERIAL NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "accounting_entity_id" INTEGER NOT NULL,
  "tax_type" "tax_declaration_type_enum" NOT NULL,
  "jurisdiction_key" VARCHAR(100) NOT NULL DEFAULT 'CO-DIAN',
  "source_kind" VARCHAR(30) NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "currency" VARCHAR(10) NOT NULL DEFAULT 'COP',
  "effective_date" DATE NOT NULL,
  "source_declaration_id" INTEGER,
  "evidence_id" INTEGER,
  "accounting_entry_id" INTEGER,
  "reference" VARCHAR(160),
  "status" VARCHAR(30) NOT NULL DEFAULT 'draft',
  "metadata" JSONB,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_tax_credits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "fiscal_credit_applications" (
  "id" SERIAL NOT NULL,
  "credit_id" INTEGER NOT NULL,
  "declaration_id" INTEGER NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'applied',
  "reversed_at" TIMESTAMP(6),
  "created_by" INTEGER,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_credit_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fiscal_credit_applications_credit_decl_key" UNIQUE ("credit_id", "declaration_id")
);

CREATE TABLE IF NOT EXISTS "fiscal_tax_payments" (
  "id" SERIAL NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "accounting_entity_id" INTEGER NOT NULL,
  "obligation_id" INTEGER NOT NULL,
  "declaration_id" INTEGER,
  "tax_type" "tax_declaration_type_enum" NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "currency" VARCHAR(10) NOT NULL DEFAULT 'COP',
  "payment_date" DATE NOT NULL,
  "method" VARCHAR(50) NOT NULL,
  "reference" VARCHAR(160),
  "evidence_id" INTEGER,
  "accounting_entry_id" INTEGER,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'posted',
  "reversal_of_id" INTEGER,
  "notes" TEXT,
  "created_by" INTEGER,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_tax_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fiscal_tax_payments_entity_idempotency_key" UNIQUE ("accounting_entity_id", "idempotency_key")
);

-- Backward-compatible fiscal metadata; defaults avoid rewriting existing rows.
ALTER TABLE "received_documents" ALTER COLUMN "issue_date" DROP NOT NULL;
ALTER TABLE "fiscal_obligations" ADD COLUMN IF NOT EXISTS "periodicity" VARCHAR(30);
ALTER TABLE "fiscal_obligations" ADD COLUMN IF NOT EXISTS "jurisdiction_key" VARCHAR(100) NOT NULL DEFAULT 'CO-DIAN';
ALTER TABLE "fiscal_obligations" ADD COLUMN IF NOT EXISTS "due_date_source" VARCHAR(255);
ALTER TABLE "fiscal_obligations" ADD COLUMN IF NOT EXISTS "due_date_verified" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "tax_declaration_drafts" ADD COLUMN IF NOT EXISTS "periodicity" VARCHAR(30);
ALTER TABLE "tax_declaration_drafts" ADD COLUMN IF NOT EXISTS "jurisdiction_key" VARCHAR(100) NOT NULL DEFAULT 'CO-DIAN';
ALTER TABLE "tax_declaration_drafts" ADD COLUMN IF NOT EXISTS "credit_amount" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "tax_declaration_drafts" ADD COLUMN IF NOT EXISTS "advance_amount" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "tax_declaration_drafts" ADD COLUMN IF NOT EXISTS "paid_amount" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- Database guards for incomplete intake, positive settlement, and non-negative source amounts.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_docs_amounts_nonnegative_check') THEN
    ALTER TABLE "received_documents" ADD CONSTRAINT "received_docs_amounts_nonnegative_check" CHECK ("subtotal_amount" >= 0 AND "discount_amount" >= 0 AND "tax_amount" >= 0 AND "total_amount" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_links_one_target_check') THEN
    ALTER TABLE "received_document_links" ADD CONSTRAINT "received_doc_links_one_target_check" CHECK (num_nonnulls("purchase_order_id", "reception_id", "expense_id", "invoice_id", "accounts_payable_id", "accounting_entry_id") = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_links_allocation_nonnegative_check') THEN
    ALTER TABLE "received_document_links" ADD CONSTRAINT "received_doc_links_allocation_nonnegative_check" CHECK ("allocation_amount" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_items_quantity_positive_check') THEN
    ALTER TABLE "received_document_items" ADD CONSTRAINT "received_doc_items_quantity_positive_check" CHECK ("quantity" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_items_amounts_nonnegative_check') THEN
    ALTER TABLE "received_document_items" ADD CONSTRAINT "received_doc_items_amounts_nonnegative_check" CHECK ("unit_price" >= 0 AND "discount_amount" >= 0 AND "net_amount" >= 0 AND "total_amount" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_taxes_amounts_nonnegative_check') THEN
    ALTER TABLE "received_document_taxes" ADD CONSTRAINT "received_doc_taxes_amounts_nonnegative_check" CHECK ("base_amount" >= 0 AND "amount" >= 0 AND "eligible_amount" >= 0 AND ("rate" IS NULL OR "rate" >= 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_credits_amount_positive_check') THEN
    ALTER TABLE "fiscal_tax_credits" ADD CONSTRAINT "fiscal_tax_credits_amount_positive_check" CHECK ("amount" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_credit_apps_amount_positive_check') THEN
    ALTER TABLE "fiscal_credit_applications" ADD CONSTRAINT "fiscal_credit_apps_amount_positive_check" CHECK ("amount" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_payments_amount_positive_check') THEN
    ALTER TABLE "fiscal_tax_payments" ADD CONSTRAINT "fiscal_tax_payments_amount_positive_check" CHECK ("amount" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doc_recv_conn_poll_interval_positive_check') THEN
    ALTER TABLE "document_reception_connections" ADD CONSTRAINT "doc_recv_conn_poll_interval_positive_check" CHECK ("poll_interval_minutes" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doc_reception_runs_counts_nonnegative_check') THEN
    ALTER TABLE "document_reception_runs" ADD CONSTRAINT "doc_reception_runs_counts_nonnegative_check" CHECK ("received_count" >= 0 AND "duplicate_count" >= 0 AND "error_count" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_declaration_drafts_settlement_nonnegative_check') THEN
    ALTER TABLE "tax_declaration_drafts" ADD CONSTRAINT "tax_declaration_drafts_settlement_nonnegative_check" CHECK ("credit_amount" >= 0 AND "advance_amount" >= 0 AND "paid_amount" >= 0);
  END IF;
END $$;

-- RESTRICT foreign keys. The guards make reruns safe without cascading deletes.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_docs_org_fkey') THEN ALTER TABLE "received_documents" ADD CONSTRAINT "received_docs_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_docs_store_fkey') THEN ALTER TABLE "received_documents" ADD CONSTRAINT "received_docs_store_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_docs_entity_fkey') THEN ALTER TABLE "received_documents" ADD CONSTRAINT "received_docs_entity_fkey" FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_docs_supplier_fkey') THEN ALTER TABLE "received_documents" ADD CONSTRAINT "received_docs_supplier_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_docs_created_by_fkey') THEN ALTER TABLE "received_documents" ADD CONSTRAINT "received_docs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_docs_reviewed_by_fkey') THEN ALTER TABLE "received_documents" ADD CONSTRAINT "received_docs_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_files_doc_fkey') THEN ALTER TABLE "received_document_files" ADD CONSTRAINT "received_doc_files_doc_fkey" FOREIGN KEY ("document_id") REFERENCES "received_documents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_items_doc_fkey') THEN ALTER TABLE "received_document_items" ADD CONSTRAINT "received_doc_items_doc_fkey" FOREIGN KEY ("document_id") REFERENCES "received_documents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_items_product_fkey') THEN ALTER TABLE "received_document_items" ADD CONSTRAINT "received_doc_items_product_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_items_variant_fkey') THEN ALTER TABLE "received_document_items" ADD CONSTRAINT "received_doc_items_variant_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_taxes_doc_fkey') THEN ALTER TABLE "received_document_taxes" ADD CONSTRAINT "received_doc_taxes_doc_fkey" FOREIGN KEY ("document_id") REFERENCES "received_documents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_taxes_item_fkey') THEN ALTER TABLE "received_document_taxes" ADD CONSTRAINT "received_doc_taxes_item_fkey" FOREIGN KEY ("item_id") REFERENCES "received_document_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_links_doc_fkey') THEN ALTER TABLE "received_document_links" ADD CONSTRAINT "received_doc_links_doc_fkey" FOREIGN KEY ("document_id") REFERENCES "received_documents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_links_po_fkey') THEN ALTER TABLE "received_document_links" ADD CONSTRAINT "received_doc_links_po_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_links_reception_fkey') THEN ALTER TABLE "received_document_links" ADD CONSTRAINT "received_doc_links_reception_fkey" FOREIGN KEY ("reception_id") REFERENCES "purchase_order_receptions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_links_expense_fkey') THEN ALTER TABLE "received_document_links" ADD CONSTRAINT "received_doc_links_expense_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_links_invoice_fkey') THEN ALTER TABLE "received_document_links" ADD CONSTRAINT "received_doc_links_invoice_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_links_ap_fkey') THEN ALTER TABLE "received_document_links" ADD CONSTRAINT "received_doc_links_ap_fkey" FOREIGN KEY ("accounts_payable_id") REFERENCES "accounts_payable"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_links_entry_fkey') THEN ALTER TABLE "received_document_links" ADD CONSTRAINT "received_doc_links_entry_fkey" FOREIGN KEY ("accounting_entry_id") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_links_user_fkey') THEN ALTER TABLE "received_document_links" ADD CONSTRAINT "received_doc_links_user_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_events_doc_fkey') THEN ALTER TABLE "received_document_events" ADD CONSTRAINT "received_doc_events_doc_fkey" FOREIGN KEY ("document_id") REFERENCES "received_documents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_events_actor_fkey') THEN ALTER TABLE "received_document_events" ADD CONSTRAINT "received_doc_events_actor_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_attempts_event_fkey') THEN ALTER TABLE "received_document_event_attempts" ADD CONSTRAINT "received_doc_attempts_event_fkey" FOREIGN KEY ("event_id") REFERENCES "received_document_events"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doc_recv_conn_org_fkey') THEN ALTER TABLE "document_reception_connections" ADD CONSTRAINT "doc_recv_conn_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doc_recv_conn_store_fkey') THEN ALTER TABLE "document_reception_connections" ADD CONSTRAINT "doc_recv_conn_store_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doc_recv_conn_entity_fkey') THEN ALTER TABLE "document_reception_connections" ADD CONSTRAINT "doc_recv_conn_entity_fkey" FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doc_recv_conn_user_fkey') THEN ALTER TABLE "document_reception_connections" ADD CONSTRAINT "doc_recv_conn_user_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doc_recv_runs_conn_fkey') THEN ALTER TABLE "document_reception_runs" ADD CONSTRAINT "doc_recv_runs_conn_fkey" FOREIGN KEY ("connection_id") REFERENCES "document_reception_connections"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_credits_org_fkey') THEN ALTER TABLE "fiscal_tax_credits" ADD CONSTRAINT "fiscal_tax_credits_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_credits_store_fkey') THEN ALTER TABLE "fiscal_tax_credits" ADD CONSTRAINT "fiscal_tax_credits_store_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_credits_entity_fkey') THEN ALTER TABLE "fiscal_tax_credits" ADD CONSTRAINT "fiscal_tax_credits_entity_fkey" FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_credits_decl_fkey') THEN ALTER TABLE "fiscal_tax_credits" ADD CONSTRAINT "fiscal_tax_credits_decl_fkey" FOREIGN KEY ("source_declaration_id") REFERENCES "tax_declaration_drafts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_credits_evidence_fkey') THEN ALTER TABLE "fiscal_tax_credits" ADD CONSTRAINT "fiscal_tax_credits_evidence_fkey" FOREIGN KEY ("evidence_id") REFERENCES "fiscal_evidences"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_credits_entry_fkey') THEN ALTER TABLE "fiscal_tax_credits" ADD CONSTRAINT "fiscal_tax_credits_entry_fkey" FOREIGN KEY ("accounting_entry_id") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_credits_user_fkey') THEN ALTER TABLE "fiscal_tax_credits" ADD CONSTRAINT "fiscal_tax_credits_user_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_credit_apps_credit_fkey') THEN ALTER TABLE "fiscal_credit_applications" ADD CONSTRAINT "fiscal_credit_apps_credit_fkey" FOREIGN KEY ("credit_id") REFERENCES "fiscal_tax_credits"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_credit_apps_decl_fkey') THEN ALTER TABLE "fiscal_credit_applications" ADD CONSTRAINT "fiscal_credit_apps_decl_fkey" FOREIGN KEY ("declaration_id") REFERENCES "tax_declaration_drafts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_credit_apps_user_fkey') THEN ALTER TABLE "fiscal_credit_applications" ADD CONSTRAINT "fiscal_credit_apps_user_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_payments_org_fkey') THEN ALTER TABLE "fiscal_tax_payments" ADD CONSTRAINT "fiscal_tax_payments_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_payments_store_fkey') THEN ALTER TABLE "fiscal_tax_payments" ADD CONSTRAINT "fiscal_tax_payments_store_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_payments_entity_fkey') THEN ALTER TABLE "fiscal_tax_payments" ADD CONSTRAINT "fiscal_tax_payments_entity_fkey" FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_payments_obligation_fkey') THEN ALTER TABLE "fiscal_tax_payments" ADD CONSTRAINT "fiscal_tax_payments_obligation_fkey" FOREIGN KEY ("obligation_id") REFERENCES "fiscal_obligations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_payments_decl_fkey') THEN ALTER TABLE "fiscal_tax_payments" ADD CONSTRAINT "fiscal_tax_payments_decl_fkey" FOREIGN KEY ("declaration_id") REFERENCES "tax_declaration_drafts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_payments_evidence_fkey') THEN ALTER TABLE "fiscal_tax_payments" ADD CONSTRAINT "fiscal_tax_payments_evidence_fkey" FOREIGN KEY ("evidence_id") REFERENCES "fiscal_evidences"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_payments_entry_fkey') THEN ALTER TABLE "fiscal_tax_payments" ADD CONSTRAINT "fiscal_tax_payments_entry_fkey" FOREIGN KEY ("accounting_entry_id") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_payments_user_fkey') THEN ALTER TABLE "fiscal_tax_payments" ADD CONSTRAINT "fiscal_tax_payments_user_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_tax_payments_reversal_fkey') THEN ALTER TABLE "fiscal_tax_payments" ADD CONSTRAINT "fiscal_tax_payments_reversal_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "fiscal_tax_payments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION; END IF;
END $$;

-- Tax credit origin is unique per declaration/tax family when sourced from a declaration.
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_tax_credits_source_decl_tax_key"
  ON "fiscal_tax_credits" ("source_declaration_id", "tax_type") WHERE "source_declaration_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "received_docs_org_entity_date_idx" ON "received_documents" ("organization_id", "accounting_entity_id", "issue_date");
CREATE INDEX IF NOT EXISTS "received_docs_org_entity_processing_idx" ON "received_documents" ("organization_id", "accounting_entity_id", "processing_status");
CREATE INDEX IF NOT EXISTS "received_docs_org_entity_review_idx" ON "received_documents" ("organization_id", "accounting_entity_id", "review_status");
CREATE INDEX IF NOT EXISTS "received_docs_org_entity_fiscal_idx" ON "received_documents" ("organization_id", "accounting_entity_id", "fiscal_status");
CREATE INDEX IF NOT EXISTS "received_docs_entity_document_key_idx" ON "received_documents" ("accounting_entity_id", "document_key");
CREATE INDEX IF NOT EXISTS "received_docs_entity_source_hash_idx" ON "received_documents" ("accounting_entity_id", "source_hash");
CREATE INDEX IF NOT EXISTS "received_doc_files_document_idx" ON "received_document_files" ("document_id");
CREATE INDEX IF NOT EXISTS "received_doc_items_document_idx" ON "received_document_items" ("document_id");
CREATE INDEX IF NOT EXISTS "received_doc_items_product_idx" ON "received_document_items" ("product_id");
CREATE INDEX IF NOT EXISTS "received_doc_items_variant_idx" ON "received_document_items" ("product_variant_id");
CREATE INDEX IF NOT EXISTS "received_doc_taxes_document_idx" ON "received_document_taxes" ("document_id");
CREATE INDEX IF NOT EXISTS "received_doc_taxes_item_idx" ON "received_document_taxes" ("item_id");
CREATE INDEX IF NOT EXISTS "received_doc_taxes_document_type_idx" ON "received_document_taxes" ("document_id", "tax_type");
CREATE INDEX IF NOT EXISTS "received_doc_links_document_idx" ON "received_document_links" ("document_id");
CREATE INDEX IF NOT EXISTS "received_doc_links_po_idx" ON "received_document_links" ("purchase_order_id");
CREATE INDEX IF NOT EXISTS "received_doc_links_reception_idx" ON "received_document_links" ("reception_id");
CREATE INDEX IF NOT EXISTS "received_doc_links_expense_idx" ON "received_document_links" ("expense_id");
CREATE INDEX IF NOT EXISTS "received_doc_links_invoice_idx" ON "received_document_links" ("invoice_id");
CREATE INDEX IF NOT EXISTS "received_doc_links_ap_idx" ON "received_document_links" ("accounts_payable_id");
CREATE INDEX IF NOT EXISTS "received_doc_links_entry_idx" ON "received_document_links" ("accounting_entry_id");
CREATE INDEX IF NOT EXISTS "received_doc_events_document_status_idx" ON "received_document_events" ("document_id", "status");
CREATE INDEX IF NOT EXISTS "received_doc_event_attempt_event_idx" ON "received_document_event_attempts" ("event_id");
CREATE INDEX IF NOT EXISTS "doc_reception_connections_entity_idx" ON "document_reception_connections" ("accounting_entity_id");
CREATE INDEX IF NOT EXISTS "doc_reception_connections_enabled_next_idx" ON "document_reception_connections" ("enabled", "next_sync_at");
CREATE INDEX IF NOT EXISTS "doc_reception_runs_connection_status_idx" ON "document_reception_runs" ("connection_id", "status");
CREATE INDEX IF NOT EXISTS "fiscal_tax_credits_entity_type_status_date_idx" ON "fiscal_tax_credits" ("accounting_entity_id", "tax_type", "status", "effective_date");
CREATE INDEX IF NOT EXISTS "fiscal_tax_credits_source_declaration_idx" ON "fiscal_tax_credits" ("source_declaration_id");
CREATE INDEX IF NOT EXISTS "fiscal_tax_credits_evidence_idx" ON "fiscal_tax_credits" ("evidence_id");
CREATE INDEX IF NOT EXISTS "fiscal_tax_credits_entry_idx" ON "fiscal_tax_credits" ("accounting_entry_id");
CREATE INDEX IF NOT EXISTS "fiscal_credit_applications_decl_status_idx" ON "fiscal_credit_applications" ("declaration_id", "status");
CREATE INDEX IF NOT EXISTS "fiscal_tax_payments_obligation_idx" ON "fiscal_tax_payments" ("obligation_id");
CREATE INDEX IF NOT EXISTS "fiscal_tax_payments_declaration_idx" ON "fiscal_tax_payments" ("declaration_id");
CREATE INDEX IF NOT EXISTS "fiscal_tax_payments_entity_type_date_idx" ON "fiscal_tax_payments" ("accounting_entity_id", "tax_type", "payment_date");
CREATE INDEX IF NOT EXISTS "fiscal_tax_payments_evidence_idx" ON "fiscal_tax_payments" ("evidence_id");
CREATE INDEX IF NOT EXISTS "fiscal_tax_payments_entry_idx" ON "fiscal_tax_payments" ("accounting_entry_id");
CREATE INDEX IF NOT EXISTS "fiscal_tax_payments_reversal_idx" ON "fiscal_tax_payments" ("reversal_of_id");
