-- DATA IMPACT:
-- Tables affected: orders, invoice_data_requests, invoice_holder_changes (new), invoice_holder_change_accounting_effects (new)
-- Expected row changes: 0 historical business rows; nullable additions only
-- Destructive operations: none; no DELETE/TRUNCATE/DROP/backfill
-- FK/cascade risk: new RESTRICT/NO ACTION relations; no ON DELETE CASCADE
-- Idempotency: IF NOT EXISTS and pg_constraint guards; no historical uniqueness retrofit
-- Approval: deploy only through authorized release; not applied by feature development
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "public_access_token" VARCHAR(64);
ALTER TABLE "invoice_data_requests" ADD COLUMN IF NOT EXISTS "origin" VARCHAR(30), ADD COLUMN IF NOT EXISTS "opened_at" TIMESTAMP(6), ADD COLUMN IF NOT EXISTS "active_invoice_key" VARCHAR(100), ADD COLUMN IF NOT EXISTS "submission_hash" VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS "orders_public_access_token_key" ON "orders"("public_access_token");
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_data_requests_active_invoice_key_key" ON "invoice_data_requests"("active_invoice_key");
CREATE TABLE IF NOT EXISTS "invoice_holder_changes" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER NOT NULL,
  "accounting_entity_id" INTEGER NOT NULL,
  "original_order_id" INTEGER NOT NULL,
  "original_invoice_id" INTEGER NOT NULL,
  "request_id" INTEGER,
  "mode" VARCHAR(30) NOT NULL,
  "purpose" VARCHAR(30) NOT NULL DEFAULT 'holder_change',
  "phase" VARCHAR(50) NOT NULL DEFAULT 'requested',
  "run_status" VARCHAR(30) NOT NULL DEFAULT 'ready',
  "active_order_key" VARCHAR(100),
  "previous_customer_id" INTEGER,
  "target_customer_id" INTEGER,
  "customer_snapshot" JSONB,
  "economic_snapshot_hash" VARCHAR(64) NOT NULL,
  "credit_note_id" INTEGER,
  "new_invoice_id" INTEGER,
  "created_by_user_id" INTEGER,
  "reason" VARCHAR(500) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" VARCHAR(100),
  "last_error_message" VARCHAR(500),
  "next_retry_at" TIMESTAMP(6),
  "lease_owner" VARCHAR(100),
  "lease_expires_at" TIMESTAMP(6),
  "released_at" TIMESTAMP(6),
  "completed_at" TIMESTAMP(6),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_holder_changes_original_invoice_id_key" ON "invoice_holder_changes"("original_invoice_id");
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_holder_changes_request_id_key" ON "invoice_holder_changes"("request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_holder_changes_active_order_key_key" ON "invoice_holder_changes"("active_order_key");
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_holder_changes_credit_note_id_key" ON "invoice_holder_changes"("credit_note_id");
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_holder_changes_new_invoice_id_key" ON "invoice_holder_changes"("new_invoice_id");
CREATE INDEX IF NOT EXISTS "invoice_holder_changes_store_id_run_status_next_retry_at_idx" ON "invoice_holder_changes"("store_id","run_status","next_retry_at");
CREATE INDEX IF NOT EXISTS "invoice_holder_changes_organization_id_original_order_id_idx" ON "invoice_holder_changes"("organization_id","original_order_id");
CREATE INDEX IF NOT EXISTS "invoice_holder_changes_lease_expires_at_idx" ON "invoice_holder_changes"("lease_expires_at");
CREATE TABLE IF NOT EXISTS "invoice_holder_change_accounting_effects" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "operation_id" INTEGER NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "store_id" INTEGER NOT NULL,
  "accounting_entity_id" INTEGER NOT NULL,
  "role" VARCHAR(20) NOT NULL,
  "state" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "invoice_id" INTEGER,
  "accounting_entry_id" INTEGER,
  "source_credit_note_id" INTEGER,
  "clearing_amount" DECIMAL(18,2),
  "error_code" VARCHAR(100),
  "error_message" VARCHAR(500),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_retry_at" TIMESTAMP(6),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL,
  "applied_at" TIMESTAMP(6)
);
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_holder_change_accounting_effects_source_credit_note_id_key" ON "invoice_holder_change_accounting_effects"("source_credit_note_id");
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_holder_change_accounting_effects_operation_id_role_key" ON "invoice_holder_change_accounting_effects"("operation_id","role");
CREATE INDEX IF NOT EXISTS "invoice_holder_change_accounting_effects_store_id_state_next_retry_at_idx" ON "invoice_holder_change_accounting_effects"("store_id","state","next_retry_at");
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_changes_organization_id_fkey') THEN
ALTER TABLE "invoice_holder_changes" ADD CONSTRAINT "invoice_holder_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_changes_store_id_fkey') THEN
ALTER TABLE "invoice_holder_changes" ADD CONSTRAINT "invoice_holder_changes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_changes_accounting_entity_id_fkey') THEN
ALTER TABLE "invoice_holder_changes" ADD CONSTRAINT "invoice_holder_changes_accounting_entity_id_fkey" FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_changes_original_order_id_fkey') THEN
ALTER TABLE "invoice_holder_changes" ADD CONSTRAINT "invoice_holder_changes_original_order_id_fkey" FOREIGN KEY ("original_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_changes_original_invoice_id_fkey') THEN
ALTER TABLE "invoice_holder_changes" ADD CONSTRAINT "invoice_holder_changes_original_invoice_id_fkey" FOREIGN KEY ("original_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_changes_request_id_fkey') THEN
ALTER TABLE "invoice_holder_changes" ADD CONSTRAINT "invoice_holder_changes_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "invoice_data_requests"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_changes_credit_note_id_fkey') THEN
ALTER TABLE "invoice_holder_changes" ADD CONSTRAINT "invoice_holder_changes_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_changes_new_invoice_id_fkey') THEN
ALTER TABLE "invoice_holder_changes" ADD CONSTRAINT "invoice_holder_changes_new_invoice_id_fkey" FOREIGN KEY ("new_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_changes_created_by_user_id_fkey') THEN
ALTER TABLE "invoice_holder_changes" ADD CONSTRAINT "invoice_holder_changes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_changes_previous_customer_id_fkey') THEN
ALTER TABLE "invoice_holder_changes" ADD CONSTRAINT "invoice_holder_changes_previous_customer_id_fkey" FOREIGN KEY ("previous_customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_changes_target_customer_id_fkey') THEN
ALTER TABLE "invoice_holder_changes" ADD CONSTRAINT "invoice_holder_changes_target_customer_id_fkey" FOREIGN KEY ("target_customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_change_accounting_effects_operation_id_fkey') THEN
ALTER TABLE "invoice_holder_change_accounting_effects" ADD CONSTRAINT "invoice_holder_change_accounting_effects_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "invoice_holder_changes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_change_accounting_effects_organization_id_fkey') THEN
ALTER TABLE "invoice_holder_change_accounting_effects" ADD CONSTRAINT "invoice_holder_change_accounting_effects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_change_accounting_effects_store_id_fkey') THEN
ALTER TABLE "invoice_holder_change_accounting_effects" ADD CONSTRAINT "invoice_holder_change_accounting_effects_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ihcae_accounting_entity_id_fkey') THEN
ALTER TABLE "invoice_holder_change_accounting_effects" ADD CONSTRAINT "ihcae_accounting_entity_id_fkey" FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_change_accounting_effects_invoice_id_fkey') THEN
ALTER TABLE "invoice_holder_change_accounting_effects" ADD CONSTRAINT "invoice_holder_change_accounting_effects_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ihcae_source_credit_note_id_fkey') THEN
ALTER TABLE "invoice_holder_change_accounting_effects" ADD CONSTRAINT "ihcae_source_credit_note_id_fkey" FOREIGN KEY ("source_credit_note_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ihcae_accounting_entry_id_fkey') THEN
ALTER TABLE "invoice_holder_change_accounting_effects" ADD CONSTRAINT "ihcae_accounting_entry_id_fkey" FOREIGN KEY ("accounting_entry_id") REFERENCES "accounting_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_changes_mode_check') THEN ALTER TABLE "invoice_holder_changes" ADD CONSTRAINT "invoice_holder_changes_mode_check" CHECK (mode IN ('public','manual','release_only')); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_changes_run_status_check') THEN ALTER TABLE "invoice_holder_changes" ADD CONSTRAINT "invoice_holder_changes_run_status_check" CHECK (run_status IN ('ready','running','waiting','retryable_error','action_required','completed')); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_change_accounting_effects_role_check') THEN ALTER TABLE "invoice_holder_change_accounting_effects" ADD CONSTRAINT "invoice_holder_change_accounting_effects_role_check" CHECK (role IN ('credit_note','replacement')); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_holder_change_accounting_effects_state_check') THEN ALTER TABLE "invoice_holder_change_accounting_effects" ADD CONSTRAINT "invoice_holder_change_accounting_effects_state_check" CHECK (state IN ('pending','posted','skipped','failed')); END IF; END $$;
