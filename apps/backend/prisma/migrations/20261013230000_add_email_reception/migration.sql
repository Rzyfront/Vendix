-- DATA IMPACT:
-- Tables affected: NEW document_reception_email_inboxes, document_reception_email_messages only.
-- Expected row changes: 0 existing rows; no backfill or business-row mutations.
-- Destructive operations: none; existing connections and fiscal file tables are untouched.
-- FK/cascade risk: all new foreign keys use ON DELETE RESTRICT / ON UPDATE NO ACTION.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS and catalog-guarded new constraints.
-- Approval: approved email reception P0.2a plan; SQL must be reviewed before local application.
-- New Timestamp(6) values use the domain's UTC wall-clock convention.

CREATE TABLE IF NOT EXISTS "document_reception_email_inboxes" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "accounting_entity_id" INTEGER NOT NULL,
    "local_part" VARCHAR(64) NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "environment" VARCHAR(20) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" INTEGER NOT NULL,
    "updated_by" INTEGER NOT NULL,
    "policy_version" VARCHAR(100) NOT NULL,
    "policy_accepted_at" TIMESTAMP(6) NOT NULL,
    "first_valid_received_at" TIMESTAMP(6),
    "last_email_at" TIMESTAMP(6),
    "last_valid_received_at" TIMESTAMP(6),
    "last_error_code" VARCHAR(100),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_reception_email_inboxes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "document_reception_email_messages" (
    "id" SERIAL NOT NULL,
    "inbox_id" INTEGER NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "accounting_entity_id" INTEGER NOT NULL,
    "local_part" VARCHAR(64) NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "environment" VARCHAR(20) NOT NULL,
    "recipient_alias" VARCHAR(320) NOT NULL,
    "ses_message_id" VARCHAR(255) NOT NULL,
    "sns_message_id" VARCHAR(255),
    "rfc_message_id_hash" VARCHAR(64),
    "raw_bucket" VARCHAR(255) NOT NULL,
    "raw_key" VARCHAR(1024) NOT NULL,
    "raw_sha256" VARCHAR(64),
    "raw_bytes" INTEGER,
    "received_at" TIMESTAMP(6) NOT NULL,
    "processed_at" TIMESTAMP(6),
    "status" VARCHAR(30) NOT NULL DEFAULT 'received',
    "reason_code" VARCHAR(100),
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "processing_token" VARCHAR(64),
    "processing_started_at" TIMESTAMP(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "sender" VARCHAR(255),
    "subject" VARCHAR(255),
    "parts" JSONB NOT NULL DEFAULT '[]'::JSONB,
    "gmail_code_encrypted" TEXT,
    "gmail_code_expires_at" TIMESTAMP(6),
    "gmail_challenge_alias" VARCHAR(320),
    "archived_at" TIMESTAMP(6),
    "archived_by" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_reception_email_messages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "doc_email_inboxes_store_key" ON "document_reception_email_inboxes"("store_id");
CREATE UNIQUE INDEX IF NOT EXISTS "doc_email_inboxes_local_part_key" ON "document_reception_email_inboxes"("local_part");
CREATE INDEX IF NOT EXISTS "doc_email_inboxes_org_enabled_idx" ON "document_reception_email_inboxes"("organization_id", "enabled");
CREATE INDEX IF NOT EXISTS "doc_email_inboxes_entity_idx" ON "document_reception_email_inboxes"("accounting_entity_id");
CREATE INDEX IF NOT EXISTS "doc_email_inboxes_creator_idx" ON "document_reception_email_inboxes"("created_by");
CREATE INDEX IF NOT EXISTS "doc_email_inboxes_updater_idx" ON "document_reception_email_inboxes"("updated_by");
CREATE UNIQUE INDEX IF NOT EXISTS "doc_email_messages_transport_key" ON "document_reception_email_messages"("environment", "ses_message_id", "recipient_alias");
CREATE INDEX IF NOT EXISTS "doc_email_messages_store_received_idx" ON "document_reception_email_messages"("store_id", "received_at", "id");
CREATE INDEX IF NOT EXISTS "doc_email_messages_store_status_idx" ON "document_reception_email_messages"("store_id", "status", "archived_at", "received_at");
CREATE INDEX IF NOT EXISTS "doc_email_messages_org_store_idx" ON "document_reception_email_messages"("organization_id", "store_id");
CREATE INDEX IF NOT EXISTS "doc_email_messages_entity_idx" ON "document_reception_email_messages"("accounting_entity_id");
CREATE INDEX IF NOT EXISTS "doc_email_messages_inbox_received_idx" ON "document_reception_email_messages"("inbox_id", "received_at");
CREATE INDEX IF NOT EXISTS "doc_email_messages_archiver_idx" ON "document_reception_email_messages"("archived_by");

-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS. Scope catalog guards to the table.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_inboxes_org_fkey' AND conrelid = '"document_reception_email_inboxes"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_inboxes" ADD CONSTRAINT "doc_email_inboxes_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_inboxes_store_fkey' AND conrelid = '"document_reception_email_inboxes"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_inboxes" ADD CONSTRAINT "doc_email_inboxes_store_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_inboxes_entity_fkey' AND conrelid = '"document_reception_email_inboxes"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_inboxes" ADD CONSTRAINT "doc_email_inboxes_entity_fkey" FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_inboxes_creator_fkey' AND conrelid = '"document_reception_email_inboxes"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_inboxes" ADD CONSTRAINT "doc_email_inboxes_creator_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_inboxes_updater_fkey' AND conrelid = '"document_reception_email_inboxes"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_inboxes" ADD CONSTRAINT "doc_email_inboxes_updater_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_messages_inbox_fkey' AND conrelid = '"document_reception_email_messages"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_messages" ADD CONSTRAINT "doc_email_messages_inbox_fkey" FOREIGN KEY ("inbox_id") REFERENCES "document_reception_email_inboxes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_messages_org_fkey' AND conrelid = '"document_reception_email_messages"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_messages" ADD CONSTRAINT "doc_email_messages_org_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_messages_store_fkey' AND conrelid = '"document_reception_email_messages"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_messages" ADD CONSTRAINT "doc_email_messages_store_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_messages_entity_fkey' AND conrelid = '"document_reception_email_messages"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_messages" ADD CONSTRAINT "doc_email_messages_entity_fkey" FOREIGN KEY ("accounting_entity_id") REFERENCES "accounting_entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_messages_archiver_fkey' AND conrelid = '"document_reception_email_messages"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_messages" ADD CONSTRAINT "doc_email_messages_archiver_fkey" FOREIGN KEY ("archived_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_inboxes_version_check' AND conrelid = '"document_reception_email_inboxes"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_inboxes" ADD CONSTRAINT "doc_email_inboxes_version_check" CHECK ("version" >= 1);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_inboxes_local_part_check' AND conrelid = '"document_reception_email_inboxes"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_inboxes" ADD CONSTRAINT "doc_email_inboxes_local_part_check" CHECK ("local_part" ~ '^facturas-[0-9a-f]{32}$');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_messages_version_check' AND conrelid = '"document_reception_email_messages"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_messages" ADD CONSTRAINT "doc_email_messages_version_check" CHECK ("version" >= 1);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_messages_attempt_check' AND conrelid = '"document_reception_email_messages"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_messages" ADD CONSTRAINT "doc_email_messages_attempt_check" CHECK ("attempt_count" >= 0);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_messages_bytes_check' AND conrelid = '"document_reception_email_messages"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_messages" ADD CONSTRAINT "doc_email_messages_bytes_check" CHECK ("raw_bytes" IS NULL OR "raw_bytes" >= 0);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_messages_status_check' AND conrelid = '"document_reception_email_messages"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_messages" ADD CONSTRAINT "doc_email_messages_status_check" CHECK ("status" IN ('received', 'processing', 'processed', 'partial', 'not_processed', 'failed', 'ignored'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_messages_processing_pair_check' AND conrelid = '"document_reception_email_messages"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_messages" ADD CONSTRAINT "doc_email_messages_processing_pair_check" CHECK (("processing_token" IS NULL) = ("processing_started_at" IS NULL));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_messages_recipient_snapshot_check' AND conrelid = '"document_reception_email_messages"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_messages" ADD CONSTRAINT "doc_email_messages_recipient_snapshot_check" CHECK ("recipient_alias" = "local_part" || '@' || "domain");
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_messages_parts_check' AND conrelid = '"document_reception_email_messages"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_messages" ADD CONSTRAINT "doc_email_messages_parts_check" CHECK (CASE WHEN jsonb_typeof("parts") = 'array' THEN jsonb_array_length("parts") <= 40 AND octet_length("parts"::TEXT) <= 131072 ELSE false END);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_messages_gmail_fields_check' AND conrelid = '"document_reception_email_messages"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_messages" ADD CONSTRAINT "doc_email_messages_gmail_fields_check" CHECK (("gmail_code_encrypted" IS NULL AND "gmail_code_expires_at" IS NULL AND "gmail_challenge_alias" IS NULL) OR ("gmail_code_encrypted" IS NOT NULL AND "gmail_code_expires_at" IS NOT NULL AND "gmail_challenge_alias" IS NOT NULL AND "gmail_challenge_alias" = "recipient_alias"));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'doc_email_messages_archive_pair_check' AND conrelid = '"document_reception_email_messages"'::regclass
    ) THEN
        ALTER TABLE "document_reception_email_messages" ADD CONSTRAINT "doc_email_messages_archive_pair_check" CHECK (("archived_at" IS NULL) = ("archived_by" IS NULL));
    END IF;
END $$;
