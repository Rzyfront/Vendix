-- External and custom-record Flows (flujos-adm P3): inbound webhooks per flow
-- (P3.1), store secrets for the HTTP node (P3.2), per-flow mailboxes (P3.3),
-- captcha flag and chunked uploads for public forms (P3.4), tracking magic
-- links (P3.5) and custom collections with their records (P3.6).
-- Additive only: new tables, one defaulted column, indexes and RESTRICT FKs.
--
-- DATA IMPACT: none. No existing row changes beyond the column default
--   (`workflow_public_links.captcha_required` = false keeps every link as is).
--   Destructive operations: none.
--   FK/cascade risk: none. Every new FK is ON DELETE RESTRICT and only new
--     tables point to existing ones (stores, workflow_definitions,
--     workflow_instances); nothing points to the new tables from old ones.
--   Idempotency: guarded by IF NOT EXISTS / pg_constraint checks.


ALTER TABLE "workflow_public_links" ADD COLUMN IF NOT EXISTS "captcha_required" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "workflow_inbound_hooks" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "definition_id" INTEGER NOT NULL,
    "public_id" VARCHAR(40) NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "rate_limit_per_minute" INTEGER NOT NULL DEFAULT 60,
    "created_by_user_id" INTEGER NOT NULL,
    "last_used_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_inbound_hooks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflow_inbound_requests" (
    "id" BIGSERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "hook_id" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "instance_id" INTEGER,
    "status" VARCHAR(20) NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_inbound_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflow_secrets" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "value_enc" TEXT NOT NULL,
    "description" VARCHAR(200),
    "created_by_user_id" INTEGER NOT NULL,
    "last_used_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_secrets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflow_mailboxes" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "definition_id" INTEGER NOT NULL,
    "local_part" VARCHAR(64) NOT NULL,
    "domain" VARCHAR(120) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" INTEGER NOT NULL,
    "last_received_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_mailboxes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflow_mailbox_messages" (
    "id" BIGSERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "mailbox_id" INTEGER NOT NULL,
    "message_id" VARCHAR(255) NOT NULL,
    "from_email" VARCHAR(255),
    "subject" VARCHAR(300),
    "instance_id" INTEGER,
    "status" VARCHAR(20) NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_mailbox_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflow_upload_sessions" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "public_id" VARCHAR(40) NOT NULL,
    "public_link_id" INTEGER,
    "tracking_link_id" INTEGER,
    "field_key" VARCHAR(80),
    "requirement_key" VARCHAR(80),
    "s3_key" VARCHAR(512) NOT NULL,
    "s3_upload_id" VARCHAR(1024),
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "chunk_size" INTEGER NOT NULL,
    "parts" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "stored_file_id" INTEGER,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_upload_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflow_tracking_links" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "instance_id" INTEGER NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "contact_name" VARCHAR(160),
    "contact_email" VARCHAR(200),
    "expires_at" TIMESTAMP(6) NOT NULL,
    "revoked_at" TIMESTAMP(6),
    "last_used_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_tracking_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflow_collections" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "item_name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "icon" VARCHAR(40),
    "fields" JSONB NOT NULL DEFAULT '[]',
    "title_field" VARCHAR(80),
    "reference_prefix" VARCHAR(10) NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_collections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflow_records" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "collection_id" INTEGER NOT NULL,
    "reference" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" INTEGER NOT NULL,
    "updated_by_user_id" INTEGER,
    "archived_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_inbound_hooks_definition_id_key" ON "workflow_inbound_hooks"("definition_id");

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_inbound_hooks_public_id_key" ON "workflow_inbound_hooks"("public_id");

CREATE INDEX IF NOT EXISTS "workflow_inbound_hooks_store_id_idx" ON "workflow_inbound_hooks"("store_id");

CREATE INDEX IF NOT EXISTS "workflow_inbound_requests_hook_id_created_at_idx" ON "workflow_inbound_requests"("hook_id", "created_at");

CREATE INDEX IF NOT EXISTS "workflow_inbound_requests_store_id_idx" ON "workflow_inbound_requests"("store_id");

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_inbound_requests_hook_id_idempotency_key_key" ON "workflow_inbound_requests"("hook_id", "idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_secrets_store_id_name_key" ON "workflow_secrets"("store_id", "name");

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_mailboxes_definition_id_key" ON "workflow_mailboxes"("definition_id");

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_mailboxes_local_part_key" ON "workflow_mailboxes"("local_part");

CREATE INDEX IF NOT EXISTS "workflow_mailboxes_store_id_idx" ON "workflow_mailboxes"("store_id");

CREATE INDEX IF NOT EXISTS "workflow_mailbox_messages_store_id_idx" ON "workflow_mailbox_messages"("store_id");

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_mailbox_messages_mailbox_id_message_id_key" ON "workflow_mailbox_messages"("mailbox_id", "message_id");

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_upload_sessions_public_id_key" ON "workflow_upload_sessions"("public_id");

CREATE INDEX IF NOT EXISTS "workflow_upload_sessions_store_id_status_expires_at_idx" ON "workflow_upload_sessions"("store_id", "status", "expires_at");

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_tracking_links_token_hash_key" ON "workflow_tracking_links"("token_hash");

CREATE INDEX IF NOT EXISTS "workflow_tracking_links_store_id_instance_id_idx" ON "workflow_tracking_links"("store_id", "instance_id");

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_collections_store_id_key_key" ON "workflow_collections"("store_id", "key");

CREATE INDEX IF NOT EXISTS "workflow_records_store_id_collection_id_archived_at_idx" ON "workflow_records"("store_id", "collection_id", "archived_at");

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_records_collection_id_reference_key" ON "workflow_records"("collection_id", "reference");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_inbound_hooks_store_id_fkey') THEN
    ALTER TABLE "workflow_inbound_hooks" ADD CONSTRAINT "workflow_inbound_hooks_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_inbound_hooks_definition_id_fkey') THEN
    ALTER TABLE "workflow_inbound_hooks" ADD CONSTRAINT "workflow_inbound_hooks_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_inbound_requests_store_id_fkey') THEN
    ALTER TABLE "workflow_inbound_requests" ADD CONSTRAINT "workflow_inbound_requests_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_inbound_requests_hook_id_fkey') THEN
    ALTER TABLE "workflow_inbound_requests" ADD CONSTRAINT "workflow_inbound_requests_hook_id_fkey" FOREIGN KEY ("hook_id") REFERENCES "workflow_inbound_hooks"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_secrets_store_id_fkey') THEN
    ALTER TABLE "workflow_secrets" ADD CONSTRAINT "workflow_secrets_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_mailboxes_store_id_fkey') THEN
    ALTER TABLE "workflow_mailboxes" ADD CONSTRAINT "workflow_mailboxes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_mailboxes_definition_id_fkey') THEN
    ALTER TABLE "workflow_mailboxes" ADD CONSTRAINT "workflow_mailboxes_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_mailbox_messages_store_id_fkey') THEN
    ALTER TABLE "workflow_mailbox_messages" ADD CONSTRAINT "workflow_mailbox_messages_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_mailbox_messages_mailbox_id_fkey') THEN
    ALTER TABLE "workflow_mailbox_messages" ADD CONSTRAINT "workflow_mailbox_messages_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "workflow_mailboxes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_upload_sessions_store_id_fkey') THEN
    ALTER TABLE "workflow_upload_sessions" ADD CONSTRAINT "workflow_upload_sessions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_tracking_links_store_id_fkey') THEN
    ALTER TABLE "workflow_tracking_links" ADD CONSTRAINT "workflow_tracking_links_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_tracking_links_instance_id_fkey') THEN
    ALTER TABLE "workflow_tracking_links" ADD CONSTRAINT "workflow_tracking_links_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "workflow_instances"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_collections_store_id_fkey') THEN
    ALTER TABLE "workflow_collections" ADD CONSTRAINT "workflow_collections_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_records_store_id_fkey') THEN
    ALTER TABLE "workflow_records" ADD CONSTRAINT "workflow_records_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_records_collection_id_fkey') THEN
    ALTER TABLE "workflow_records" ADD CONSTRAINT "workflow_records_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "workflow_collections"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
