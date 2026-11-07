-- Documental completo for Flows (flujos-adm P4): document templates with
-- immutable versions and issued documents (P4.1, P4.5), simple electronic
-- signature with hash-chained append-only evidence (P4.2), OCR / AI checks
-- (P4.3), retention policies and purge reports (P4.4), and editable file
-- profiles for expiry and search (P4.6, P4.7).
-- Additive only: new enums/values, new tables, two nullable columns, indexes,
-- RESTRICT FKs and triggers.
--
-- DATA IMPACT: none. No existing row changes.
--   New nullable columns: stored_files.purged_at, dossier_items.issued_document_id.
--   The stored_files evidence trigger is replaced to also let `purged_at`
--   change (a purge deletes the S3 object and keeps the row and its hash).
--   Destructive operations: none.
--   FK/cascade risk: none. Every new FK is ON DELETE RESTRICT; only new
--     tables (and the new dossier_items column) point to existing ones.
--   Idempotency: guarded by IF NOT EXISTS / pg_type / pg_constraint /
--     pg_trigger checks and CREATE OR REPLACE FUNCTION.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_template_kind_enum') THEN
    CREATE TYPE "document_template_kind_enum" AS ENUM ('blocks', 'base_pdf');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_template_status_enum') THEN
    CREATE TYPE "document_template_status_enum" AS ENUM ('draft', 'published', 'archived');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'issued_document_status_enum') THEN
    CREATE TYPE "issued_document_status_enum" AS ENUM ('rendering', 'issued', 'pending_signature', 'signed', 'voided', 'superseded', 'failed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signature_request_status_enum') THEN
    CREATE TYPE "signature_request_status_enum" AS ENUM ('pending', 'partially_signed', 'completed', 'declined', 'expired', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signature_signer_status_enum') THEN
    CREATE TYPE "signature_signer_status_enum" AS ENUM ('pending', 'viewed', 'signed', 'declined', 'expired', 'blocked');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signature_method_enum') THEN
    CREATE TYPE "signature_method_enum" AS ENUM ('otp_email', 'otp_whatsapp');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_check_status_enum') THEN
    CREATE TYPE "document_check_status_enum" AS ENUM ('running', 'done', 'failed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_check_verdict_enum') THEN
    CREATE TYPE "document_check_verdict_enum" AS ENUM ('pass', 'warn', 'fail', 'needs_review');
  END IF;
END $$;

ALTER TYPE "stored_file_source_enum" ADD VALUE IF NOT EXISTS 'signature_image';

ALTER TYPE "dossier_item_kind_enum" ADD VALUE IF NOT EXISTS 'issued_document';

ALTER TYPE "dossier_item_kind_enum" ADD VALUE IF NOT EXISTS 'signed_document';

ALTER TABLE "stored_files" ADD COLUMN IF NOT EXISTS "purged_at" TIMESTAMP(6);

ALTER TABLE "dossier_items" ADD COLUMN IF NOT EXISTS "issued_document_id" INTEGER;

CREATE TABLE IF NOT EXISTS "document_templates" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "category" VARCHAR(40) NOT NULL DEFAULT 'other',
    "kind" "document_template_kind_enum" NOT NULL DEFAULT 'blocks',
    "status" "document_template_status_enum" NOT NULL DEFAULT 'draft',
    "draft_body" JSONB NOT NULL DEFAULT '{}',
    "base_file_id" INTEGER,
    "published_version_id" INTEGER,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "document_template_versions" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "template_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "document_template_kind_enum" NOT NULL,
    "body" JSONB NOT NULL,
    "token_schema" JSONB NOT NULL DEFAULT '[]',
    "body_hash" CHAR(64) NOT NULL,
    "base_file_id" INTEGER,
    "published_by_user_id" INTEGER NOT NULL,
    "published_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_template_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "issued_documents" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "template_id" INTEGER NOT NULL,
    "template_version_id" INTEGER NOT NULL,
    "dossier_id" INTEGER,
    "workflow_instance_id" INTEGER,
    "requirement_key" VARCHAR(80),
    "stage_key" VARCHAR(80),
    "data_snapshot" JSONB NOT NULL DEFAULT '{}',
    "data_hash" CHAR(64) NOT NULL,
    "file_id" INTEGER,
    "pdf_sha256" CHAR(64),
    "status" "issued_document_status_enum" NOT NULL DEFAULT 'rendering',
    "error" VARCHAR(500),
    "render_attempts" INTEGER NOT NULL DEFAULT 0,
    "supersedes_id" INTEGER,
    "void_reason" VARCHAR(500),
    "issued_by_type" "workflow_actor_type_enum" NOT NULL,
    "issued_by_id" INTEGER,
    "issued_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issued_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "signature_requests" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "issued_document_id" INTEGER NOT NULL,
    "document_sha256" CHAR(64) NOT NULL,
    "status" "signature_request_status_enum" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(6) NOT NULL,
    "consent_text" TEXT NOT NULL,
    "consent_text_version" VARCHAR(20) NOT NULL,
    "sealed_file_id" INTEGER,
    "sealed_sha256" CHAR(64),
    "created_by_type" "workflow_actor_type_enum" NOT NULL,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(6),
    "cancelled_at" TIMESTAMP(6),

    CONSTRAINT "signature_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "signature_signers" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "request_id" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 1,
    "name" VARCHAR(160) NOT NULL,
    "document_number" VARCHAR(30),
    "email" VARCHAR(160),
    "phone" VARCHAR(30),
    "role_label" VARCHAR(80),
    "slot_key" VARCHAR(80),
    "method" "signature_method_enum" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "otp_hash" CHAR(64),
    "otp_attempts" INTEGER NOT NULL DEFAULT 0,
    "otp_sent_at" TIMESTAMP(6),
    "otp_expires_at" TIMESTAMP(6),
    "otp_verified_at" TIMESTAMP(6),
    "status" "signature_signer_status_enum" NOT NULL DEFAULT 'pending',
    "viewed_at" TIMESTAMP(6),
    "signed_at" TIMESTAMP(6),
    "signed_ip" VARCHAR(64),
    "signed_user_agent" VARCHAR(400),
    "signature_file_id" INTEGER,
    "declined_reason" VARCHAR(500),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signature_signers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "signature_evidence_events" (
    "id" BIGSERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "request_id" INTEGER NOT NULL,
    "signer_id" INTEGER,
    "seq" INTEGER NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(400),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "prev_hash" CHAR(64),
    "event_hash" CHAR(64) NOT NULL,
    "occurred_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signature_evidence_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "document_checks" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "file_id" INTEGER NOT NULL,
    "workflow_instance_id" INTEGER,
    "check_type" VARCHAR(40) NOT NULL DEFAULT 'extract',
    "status" "document_check_status_enum" NOT NULL DEFAULT 'running',
    "app_key" VARCHAR(60) NOT NULL,
    "model" VARCHAR(80),
    "prompt_version" VARCHAR(20) NOT NULL,
    "input_sha256" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL DEFAULT '{}',
    "verdict" "document_check_verdict_enum",
    "tokens_used" INTEGER,
    "error" VARCHAR(500),
    "requested_by_user_id" INTEGER,
    "reviewed_by_user_id" INTEGER,
    "reviewed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_checks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "document_file_profiles" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "file_id" INTEGER NOT NULL,
    "doc_type" VARCHAR(60),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "extracted_text" TEXT,
    "valid_until" DATE,
    "expiry_alerted_for" DATE,
    "expiry_alerted_at" TIMESTAMP(6),
    "updated_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_file_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "document_retention_policies" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "subject_type" VARCHAR(40),
    "doc_type" VARCHAR(60),
    "retain_days" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_retention_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "document_purge_runs" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "trigger" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'running',
    "files_purged" INTEGER NOT NULL DEFAULT 0,
    "bytes_purged" BIGINT NOT NULL DEFAULT 0,
    "skipped_legal_hold" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(500),
    "started_by_user_id" INTEGER,
    "started_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(6),

    CONSTRAINT "document_purge_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "document_purge_items" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "run_id" INTEGER NOT NULL,
    "file_id" INTEGER NOT NULL,
    "policy_id" INTEGER,
    "outcome" VARCHAR(20) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_purge_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_templates_published_version_id_key" ON "document_templates"("published_version_id");

CREATE INDEX IF NOT EXISTS "document_templates_store_id_status_idx" ON "document_templates"("store_id", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "document_templates_store_id_key_key" ON "document_templates"("store_id", "key");

CREATE UNIQUE INDEX IF NOT EXISTS "document_template_versions_template_id_version_key" ON "document_template_versions"("template_id", "version");

CREATE INDEX IF NOT EXISTS "issued_documents_store_id_status_idx" ON "issued_documents"("store_id", "status");

CREATE INDEX IF NOT EXISTS "issued_documents_workflow_instance_id_requirement_key_idx" ON "issued_documents"("workflow_instance_id", "requirement_key");

CREATE UNIQUE INDEX IF NOT EXISTS "issued_documents_store_id_reference_key" ON "issued_documents"("store_id", "reference");

CREATE INDEX IF NOT EXISTS "signature_requests_store_id_status_expires_at_idx" ON "signature_requests"("store_id", "status", "expires_at");

CREATE INDEX IF NOT EXISTS "signature_requests_issued_document_id_idx" ON "signature_requests"("issued_document_id");

CREATE UNIQUE INDEX IF NOT EXISTS "signature_signers_token_hash_key" ON "signature_signers"("token_hash");

CREATE INDEX IF NOT EXISTS "signature_signers_request_id_order_idx" ON "signature_signers"("request_id", "order");

CREATE UNIQUE INDEX IF NOT EXISTS "signature_evidence_events_request_id_seq_key" ON "signature_evidence_events"("request_id", "seq");

CREATE INDEX IF NOT EXISTS "document_checks_store_id_file_id_idx" ON "document_checks"("store_id", "file_id");

CREATE INDEX IF NOT EXISTS "document_checks_store_id_input_sha256_prompt_version_idx" ON "document_checks"("store_id", "input_sha256", "prompt_version");

CREATE UNIQUE INDEX IF NOT EXISTS "document_file_profiles_file_id_key" ON "document_file_profiles"("file_id");

CREATE INDEX IF NOT EXISTS "document_file_profiles_store_id_valid_until_idx" ON "document_file_profiles"("store_id", "valid_until");

CREATE INDEX IF NOT EXISTS "document_file_profiles_store_id_doc_type_idx" ON "document_file_profiles"("store_id", "doc_type");

CREATE UNIQUE INDEX IF NOT EXISTS "document_retention_policies_store_id_key_key" ON "document_retention_policies"("store_id", "key");

CREATE INDEX IF NOT EXISTS "document_purge_runs_store_id_started_at_idx" ON "document_purge_runs"("store_id", "started_at");

CREATE INDEX IF NOT EXISTS "document_purge_items_run_id_idx" ON "document_purge_items"("run_id");

CREATE INDEX IF NOT EXISTS "document_purge_items_store_id_file_id_idx" ON "document_purge_items"("store_id", "file_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dossier_items_issued_document_id_fkey') THEN
    ALTER TABLE "dossier_items" ADD CONSTRAINT "dossier_items_issued_document_id_fkey" FOREIGN KEY ("issued_document_id") REFERENCES "issued_documents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_templates_store_id_fkey') THEN
    ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_templates_published_version_id_fkey') THEN
    ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "document_template_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_template_versions_store_id_fkey') THEN
    ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_template_versions_template_id_fkey') THEN
    ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issued_documents_store_id_fkey') THEN
    ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issued_documents_template_id_fkey') THEN
    ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issued_documents_template_version_id_fkey') THEN
    ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "document_template_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issued_documents_dossier_id_fkey') THEN
    ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issued_documents_supersedes_id_fkey') THEN
    ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "issued_documents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_requests_store_id_fkey') THEN
    ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_requests_issued_document_id_fkey') THEN
    ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_issued_document_id_fkey" FOREIGN KEY ("issued_document_id") REFERENCES "issued_documents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_signers_store_id_fkey') THEN
    ALTER TABLE "signature_signers" ADD CONSTRAINT "signature_signers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_signers_request_id_fkey') THEN
    ALTER TABLE "signature_signers" ADD CONSTRAINT "signature_signers_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "signature_requests"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_evidence_events_store_id_fkey') THEN
    ALTER TABLE "signature_evidence_events" ADD CONSTRAINT "signature_evidence_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_evidence_events_request_id_fkey') THEN
    ALTER TABLE "signature_evidence_events" ADD CONSTRAINT "signature_evidence_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "signature_requests"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signature_evidence_events_signer_id_fkey') THEN
    ALTER TABLE "signature_evidence_events" ADD CONSTRAINT "signature_evidence_events_signer_id_fkey" FOREIGN KEY ("signer_id") REFERENCES "signature_signers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_checks_store_id_fkey') THEN
    ALTER TABLE "document_checks" ADD CONSTRAINT "document_checks_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_file_profiles_store_id_fkey') THEN
    ALTER TABLE "document_file_profiles" ADD CONSTRAINT "document_file_profiles_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_file_profiles_file_id_fkey') THEN
    ALTER TABLE "document_file_profiles" ADD CONSTRAINT "document_file_profiles_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_retention_policies_store_id_fkey') THEN
    ALTER TABLE "document_retention_policies" ADD CONSTRAINT "document_retention_policies_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_purge_runs_store_id_fkey') THEN
    ALTER TABLE "document_purge_runs" ADD CONSTRAINT "document_purge_runs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_purge_items_store_id_fkey') THEN
    ALTER TABLE "document_purge_items" ADD CONSTRAINT "document_purge_items_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_purge_items_run_id_fkey') THEN
    ALTER TABLE "document_purge_items" ADD CONSTRAINT "document_purge_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "document_purge_runs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- P4.4: a purge may set `purged_at`; identity columns stay immutable.
CREATE OR REPLACE FUNCTION "stored_files_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'retention_until' - 'legal_hold' - 'deleted_at' - 'purged_at')
       = (to_jsonb(OLD) - 'retention_until' - 'legal_hold' - 'deleted_at' - 'purged_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'EVIDENCE_APPEND_ONLY: stored_files identity columns are immutable'
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD."legal_hold"
     OR (OLD."retention_until" IS NOT NULL AND OLD."retention_until" > now())
     OR EXISTS (SELECT 1 FROM "dossier_items" i WHERE i."file_id" = OLD."id") THEN
    RAISE EXCEPTION 'EVIDENCE_APPEND_ONLY: stored file % is retained or referenced', OLD."id"
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- P4.2: signature evidence is append-only (no UPDATE, no DELETE).
CREATE OR REPLACE FUNCTION "signature_evidence_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'EVIDENCE_APPEND_ONLY: % on signature_evidence_events is not allowed', TG_OP
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'signature_evidence_append_only_trg') THEN
    CREATE TRIGGER "signature_evidence_append_only_trg"
      BEFORE UPDATE OR DELETE ON "signature_evidence_events"
      FOR EACH ROW EXECUTE FUNCTION "signature_evidence_append_only"();
  END IF;
END $$;
