-- DATA IMPACT:
-- Tables affected: received_document_items and the two new match-allocation tables.
-- Expected existing row changes: zero. The source-item key is additive; new
--   allocation and tax-allocation tables are empty at creation.
-- Destructive operations: none. No DROP, DELETE, UPDATE, table rewrite, or
--   destructive FK action. All business-record foreign keys are RESTRICT.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS; constraints are catalog-guarded
--   and validated explicitly. No legacy rows are rewritten.

CREATE UNIQUE INDEX IF NOT EXISTS "received_doc_items_id_document_key"
  ON "received_document_items" ("id", "document_id");

CREATE TABLE IF NOT EXISTS "received_document_match_allocations" (
  "id" SERIAL NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "accounting_entity_id" INTEGER NOT NULL,
  "store_id" INTEGER,
  "document_id" INTEGER NOT NULL,
  "document_item_id" INTEGER NOT NULL,
  "purchase_order_id" INTEGER,
  "purchase_order_item_id" INTEGER,
  "reception_id" INTEGER,
  "reception_item_id" INTEGER,
  "expense_id" INTEGER,
  "expense_item_id" INTEGER,
  "source_quantity" DECIMAL(15,4) NOT NULL,
  "target_quantity" DECIMAL(15,4),
  "source_unit_code" VARCHAR(30),
  "target_unit_code" VARCHAR(30),
  "allocated_net_amount" DECIMAL(15,2) NOT NULL,
  "currency" VARCHAR(10) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'active',
  "idempotency_key" VARCHAR(160) NOT NULL,
  "created_by" INTEGER NOT NULL,
  "confirmed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_by" INTEGER,
  "revoked_at" TIMESTAMP(6),
  "revocation_reason" VARCHAR(500),
  "evidence" JSONB,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "received_document_match_allocations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "received_document_match_tax_allocations" (
  "id" SERIAL NOT NULL,
  "allocation_id" INTEGER NOT NULL,
  "document_tax_id" INTEGER NOT NULL,
  "allocated_amount" DECIMAL(15,2) NOT NULL,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "received_document_match_tax_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "received_doc_match_alloc_doc_idempotency_key"
  ON "received_document_match_allocations" ("document_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "received_doc_match_alloc_scope_status_idx"
  ON "received_document_match_allocations" ("organization_id", "accounting_entity_id", "store_id", "document_id", "status");
CREATE INDEX IF NOT EXISTS "received_doc_match_alloc_item_status_idx"
  ON "received_document_match_allocations" ("document_item_id", "status");
CREATE INDEX IF NOT EXISTS "received_doc_match_alloc_po_item_status_idx"
  ON "received_document_match_allocations" ("purchase_order_item_id", "status");
CREATE INDEX IF NOT EXISTS "received_doc_match_alloc_reception_item_status_idx"
  ON "received_document_match_allocations" ("reception_item_id", "status");
CREATE INDEX IF NOT EXISTS "received_doc_match_alloc_expense_status_idx"
  ON "received_document_match_allocations" ("expense_id", "status");
CREATE INDEX IF NOT EXISTS "received_doc_match_alloc_expense_item_status_idx"
  ON "received_document_match_allocations" ("expense_item_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "received_doc_match_tax_alloc_allocation_tax_key"
  ON "received_document_match_tax_allocations" ("allocation_id", "document_tax_id");
CREATE INDEX IF NOT EXISTS "received_doc_match_tax_alloc_tax_idx"
  ON "received_document_match_tax_allocations" ("document_tax_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'received_doc_match_alloc_branch_check'
      AND conrelid = 'received_document_match_allocations'::regclass
  ) THEN
    ALTER TABLE "received_document_match_allocations"
      ADD CONSTRAINT "received_doc_match_alloc_branch_check"
      CHECK (
        (
          "purchase_order_id" IS NOT NULL
          AND "purchase_order_item_id" IS NOT NULL
          AND "expense_id" IS NULL
          AND "expense_item_id" IS NULL
        )
        OR
        (
          "expense_id" IS NOT NULL
          AND "purchase_order_id" IS NULL
          AND "purchase_order_item_id" IS NULL
          AND "reception_id" IS NULL
          AND "reception_item_id" IS NULL
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'received_doc_match_alloc_reception_pair_check'
      AND conrelid = 'received_document_match_allocations'::regclass
  ) THEN
    ALTER TABLE "received_document_match_allocations"
      ADD CONSTRAINT "received_doc_match_alloc_reception_pair_check"
      CHECK (("reception_id" IS NULL) = ("reception_item_id" IS NULL)) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'received_doc_match_alloc_amounts_check'
      AND conrelid = 'received_document_match_allocations'::regclass
  ) THEN
    ALTER TABLE "received_document_match_allocations"
      ADD CONSTRAINT "received_doc_match_alloc_amounts_check"
      CHECK (
        "source_quantity" > 0
        AND ("target_quantity" IS NULL OR "target_quantity" > 0)
        AND "allocated_net_amount" >= 0
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'received_doc_match_alloc_text_check'
      AND conrelid = 'received_document_match_allocations'::regclass
  ) THEN
    ALTER TABLE "received_document_match_allocations"
      ADD CONSTRAINT "received_doc_match_alloc_text_check"
      CHECK (
        length(btrim("currency")) > 0
        AND length(btrim("idempotency_key")) > 0
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'received_doc_match_alloc_status_revocation_check'
      AND conrelid = 'received_document_match_allocations'::regclass
  ) THEN
    ALTER TABLE "received_document_match_allocations"
      ADD CONSTRAINT "received_doc_match_alloc_status_revocation_check"
      CHECK (
        (
          "status" = 'active'
          AND "revoked_by" IS NULL
          AND "revoked_at" IS NULL
          AND "revocation_reason" IS NULL
        )
        OR
        (
          "status" = 'revoked'
          AND "revoked_by" IS NOT NULL
          AND "revoked_at" IS NOT NULL
          AND "revocation_reason" IS NOT NULL
          AND length(btrim("revocation_reason")) > 0
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_match_allocations_org_fkey' AND conrelid = 'received_document_match_allocations'::regclass) THEN
    ALTER TABLE "received_document_match_allocations" ADD CONSTRAINT "received_doc_match_allocations_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_match_allocations_entity_fkey' AND conrelid = 'received_document_match_allocations'::regclass) THEN
    ALTER TABLE "received_document_match_allocations" ADD CONSTRAINT "received_doc_match_allocations_entity_fkey" FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_match_allocations_store_fkey' AND conrelid = 'received_document_match_allocations'::regclass) THEN
    ALTER TABLE "received_document_match_allocations" ADD CONSTRAINT "received_doc_match_allocations_store_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_match_allocations_document_fkey' AND conrelid = 'received_document_match_allocations'::regclass) THEN
    ALTER TABLE "received_document_match_allocations" ADD CONSTRAINT "received_doc_match_allocations_document_fkey" FOREIGN KEY ("document_id") REFERENCES "received_documents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_match_allocations_item_document_fkey' AND conrelid = 'received_document_match_allocations'::regclass) THEN
    ALTER TABLE "received_document_match_allocations" ADD CONSTRAINT "received_doc_match_allocations_item_document_fkey" FOREIGN KEY ("document_item_id", "document_id") REFERENCES "received_document_items"("id", "document_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_match_allocations_po_fkey' AND conrelid = 'received_document_match_allocations'::regclass) THEN
    ALTER TABLE "received_document_match_allocations" ADD CONSTRAINT "received_doc_match_allocations_po_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_match_allocations_po_item_fkey' AND conrelid = 'received_document_match_allocations'::regclass) THEN
    ALTER TABLE "received_document_match_allocations" ADD CONSTRAINT "received_doc_match_allocations_po_item_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_match_allocations_reception_fkey' AND conrelid = 'received_document_match_allocations'::regclass) THEN
    ALTER TABLE "received_document_match_allocations" ADD CONSTRAINT "received_doc_match_allocations_reception_fkey" FOREIGN KEY ("reception_id") REFERENCES "purchase_order_receptions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_match_allocations_reception_item_fkey' AND conrelid = 'received_document_match_allocations'::regclass) THEN
    ALTER TABLE "received_document_match_allocations" ADD CONSTRAINT "received_doc_match_allocations_reception_item_fkey" FOREIGN KEY ("reception_item_id") REFERENCES "purchase_order_reception_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_match_allocations_expense_fkey' AND conrelid = 'received_document_match_allocations'::regclass) THEN
    ALTER TABLE "received_document_match_allocations" ADD CONSTRAINT "received_doc_match_allocations_expense_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_match_allocations_expense_item_fkey' AND conrelid = 'received_document_match_allocations'::regclass) THEN
    ALTER TABLE "received_document_match_allocations" ADD CONSTRAINT "received_doc_match_allocations_expense_item_fkey" FOREIGN KEY ("expense_item_id") REFERENCES "expense_items"("id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_match_allocations_created_by_fkey' AND conrelid = 'received_document_match_allocations'::regclass) THEN
    ALTER TABLE "received_document_match_allocations" ADD CONSTRAINT "received_doc_match_allocations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_match_allocations_revoked_by_fkey' AND conrelid = 'received_document_match_allocations'::regclass) THEN
    ALTER TABLE "received_document_match_allocations" ADD CONSTRAINT "received_doc_match_allocations_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
END $$;

ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_alloc_branch_check";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_alloc_reception_pair_check";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_alloc_amounts_check";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_alloc_text_check";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_alloc_status_revocation_check";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_allocations_org_fkey";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_allocations_entity_fkey";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_allocations_store_fkey";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_allocations_document_fkey";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_allocations_item_document_fkey";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_allocations_po_fkey";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_allocations_po_item_fkey";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_allocations_reception_fkey";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_allocations_reception_item_fkey";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_allocations_expense_fkey";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_allocations_expense_item_fkey";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_allocations_created_by_fkey";
ALTER TABLE "received_document_match_allocations" VALIDATE CONSTRAINT "received_doc_match_allocations_revoked_by_fkey";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_match_tax_alloc_allocation_fkey' AND conrelid = 'received_document_match_tax_allocations'::regclass) THEN
    ALTER TABLE "received_document_match_tax_allocations" ADD CONSTRAINT "received_doc_match_tax_alloc_allocation_fkey" FOREIGN KEY ("allocation_id") REFERENCES "received_document_match_allocations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'received_doc_match_tax_alloc_tax_fkey' AND conrelid = 'received_document_match_tax_allocations'::regclass) THEN
    ALTER TABLE "received_document_match_tax_allocations" ADD CONSTRAINT "received_doc_match_tax_alloc_tax_fkey" FOREIGN KEY ("document_tax_id") REFERENCES "received_document_taxes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
END $$;

ALTER TABLE "received_document_match_tax_allocations" VALIDATE CONSTRAINT "received_doc_match_tax_alloc_allocation_fkey";
ALTER TABLE "received_document_match_tax_allocations" VALIDATE CONSTRAINT "received_doc_match_tax_alloc_tax_fkey";
