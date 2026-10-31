-- CRM · M3 (PLAN-CRM §2.3, §3): tablas del CRM.
--
-- DATA IMPACT:
--   Tables affected: 12 tablas NUEVAS (crm_conversations, crm_messages,
--   crm_tags, crm_customer_tags, crm_segments, crm_pipelines,
--   crm_pipeline_stages, crm_opportunities, crm_tasks, crm_notes,
--   crm_campaigns, crm_message_templates) + FK store_users.crm_stage_id.
--   Expected row changes: 0. No DML.
--   Destructive operations: ninguna. Sin DROP, UPDATE, DELETE ni TRUNCATE.
--   FK/cascade risk: toda FK hacia stores/users/store_users/quotations/orders/
--   social_channels es RESTRICT o SET NULL. Única CASCADE:
--   crm_customer_tags.tag_id -> crm_tags (borrar una etiqueta quita sus
--   asignaciones, nunca clientes), aprobada en PLAN-CRM §2.
--   Idempotency: CREATE TABLE/INDEX IF NOT EXISTS y FKs protegidas con
--   pg_constraint. Las tablas se crean todas antes de cualquier FK, así el
--   orden de dependencia no importa.
--   Approval: PLAN-CRM PR 1, decisiones de Rafael (2026-10-31).

-- Tablas
CREATE TABLE IF NOT EXISTS "crm_conversations" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER,
    "social_channel_id" INTEGER,
    "channel" "crm_message_channel_enum" NOT NULL,
    "contact_address" VARCHAR(160) NOT NULL,
    "status" "crm_conversation_status_enum" NOT NULL DEFAULT 'open',
    "assigned_user_id" INTEGER,
    "last_message_at" TIMESTAMP(6),
    "last_inbound_at" TIMESTAMP(6),
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "snoozed_until" TIMESTAMP(6),
    "closed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_conversations_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "crm_messages" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "direction" "crm_message_direction_enum" NOT NULL,
    "channel" "crm_message_channel_enum" NOT NULL,
    "status" "crm_message_status_enum" NOT NULL,
    "body" TEXT,
    "template_name" VARCHAR(120),
    "template_language" VARCHAR(10),
    "template_variables" JSONB,
    "media" JSONB,
    "provider" VARCHAR(30) NOT NULL,
    "provider_message_id" VARCHAR(160),
    "error_code" VARCHAR(60),
    "error_message" TEXT,
    "cost_amount" DECIMAL(12,4),
    "sent_by_user_id" INTEGER,
    "campaign_id" INTEGER,
    "webhook_event_id" INTEGER,
    "sent_at" TIMESTAMP(6),
    "delivered_at" TIMESTAMP(6),
    "read_at" TIMESTAMP(6),
    "failed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_messages_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "crm_tags" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "color" VARCHAR(20),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_tags_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "crm_customer_tags" (
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "tag_id" INTEGER NOT NULL,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_customer_tags_pkey" PRIMARY KEY ("customer_id","tag_id","store_id")
);
CREATE TABLE IF NOT EXISTS "crm_segments" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "filter" JSONB NOT NULL,
    "filter_version" INTEGER NOT NULL DEFAULT 1,
    "is_dynamic" BOOLEAN NOT NULL DEFAULT true,
    "last_count" INTEGER,
    "last_counted_at" TIMESTAMP(6),
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_segments_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "crm_pipelines" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_pipelines_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "crm_pipeline_stages" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "pipeline_id" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "kind" VARCHAR(10) NOT NULL DEFAULT 'open',
    "probability" INTEGER,
    "color" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "crm_pipeline_stages_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "crm_opportunities" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "pipeline_id" INTEGER NOT NULL,
    "stage_id" INTEGER NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "amount" DECIMAL(12,2),
    "currency" VARCHAR(3),
    "status" "crm_opportunity_status_enum" NOT NULL DEFAULT 'open',
    "owner_user_id" INTEGER,
    "quotation_id" INTEGER,
    "order_id" INTEGER,
    "expected_close_date" DATE,
    "won_at" TIMESTAMP(6),
    "lost_at" TIMESTAMP(6),
    "lost_reason" VARCHAR(160),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_opportunities_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "crm_tasks" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER,
    "opportunity_id" INTEGER,
    "conversation_id" INTEGER,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "due_at" TIMESTAMP(6),
    "status" "crm_task_status_enum" NOT NULL DEFAULT 'pending',
    "assigned_user_id" INTEGER,
    "created_by_user_id" INTEGER,
    "completed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_tasks_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "crm_notes" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_notes_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "crm_campaigns" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "channel" "crm_message_channel_enum" NOT NULL,
    "segment_id" INTEGER,
    "template_name" VARCHAR(120),
    "template_language" VARCHAR(10),
    "body" TEXT,
    "subject" VARCHAR(200),
    "status" "crm_campaign_status_enum" NOT NULL DEFAULT 'draft',
    "scheduled_at" TIMESTAMP(6),
    "started_at" TIMESTAMP(6),
    "finished_at" TIMESTAMP(6),
    "recipients_total" INTEGER NOT NULL DEFAULT 0,
    "recipients_sent" INTEGER NOT NULL DEFAULT 0,
    "recipients_failed" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost" DECIMAL(12,4),
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "crm_message_templates" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "social_channel_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "language" VARCHAR(10) NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "components" JSONB NOT NULL,
    "synced_at" TIMESTAMP(6),

    CONSTRAINT "crm_message_templates_pkey" PRIMARY KEY ("id")
);

-- Índices
CREATE INDEX IF NOT EXISTS "crm_conversations_store_id_status_last_message_at_idx" ON "crm_conversations"("store_id", "status", "last_message_at" DESC);
CREATE INDEX IF NOT EXISTS "crm_conversations_store_id_assigned_user_id_status_idx" ON "crm_conversations"("store_id", "assigned_user_id", "status");
CREATE INDEX IF NOT EXISTS "crm_conversations_customer_id_idx" ON "crm_conversations"("customer_id");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_conversations_store_id_channel_contact_address_key" ON "crm_conversations"("store_id", "channel", "contact_address");
CREATE INDEX IF NOT EXISTS "crm_messages_conversation_id_created_at_idx" ON "crm_messages"("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "crm_messages_store_id_created_at_idx" ON "crm_messages"("store_id", "created_at");
CREATE INDEX IF NOT EXISTS "crm_messages_campaign_id_idx" ON "crm_messages"("campaign_id");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_messages_provider_provider_message_id_key" ON "crm_messages"("provider", "provider_message_id");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_tags_store_id_name_key" ON "crm_tags"("store_id", "name");
CREATE INDEX IF NOT EXISTS "crm_customer_tags_store_id_tag_id_idx" ON "crm_customer_tags"("store_id", "tag_id");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_segments_store_id_name_key" ON "crm_segments"("store_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_pipelines_store_id_name_key" ON "crm_pipelines"("store_id", "name");
CREATE INDEX IF NOT EXISTS "crm_pipeline_stages_pipeline_id_sort_order_idx" ON "crm_pipeline_stages"("pipeline_id", "sort_order");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_pipeline_stages_pipeline_id_name_key" ON "crm_pipeline_stages"("pipeline_id", "name");
CREATE INDEX IF NOT EXISTS "crm_opportunities_store_id_stage_id_sort_order_idx" ON "crm_opportunities"("store_id", "stage_id", "sort_order");
CREATE INDEX IF NOT EXISTS "crm_opportunities_store_id_owner_user_id_status_idx" ON "crm_opportunities"("store_id", "owner_user_id", "status");
CREATE INDEX IF NOT EXISTS "crm_opportunities_customer_id_idx" ON "crm_opportunities"("customer_id");
CREATE INDEX IF NOT EXISTS "crm_opportunities_quotation_id_idx" ON "crm_opportunities"("quotation_id");
CREATE INDEX IF NOT EXISTS "crm_tasks_store_id_assigned_user_id_status_due_at_idx" ON "crm_tasks"("store_id", "assigned_user_id", "status", "due_at");
CREATE INDEX IF NOT EXISTS "crm_tasks_customer_id_idx" ON "crm_tasks"("customer_id");
CREATE INDEX IF NOT EXISTS "crm_notes_store_id_customer_id_created_at_idx" ON "crm_notes"("store_id", "customer_id", "created_at");
CREATE INDEX IF NOT EXISTS "crm_campaigns_store_id_status_idx" ON "crm_campaigns"("store_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_message_templates_social_channel_id_name_language_key" ON "crm_message_templates"("social_channel_id", "name", "language");
-- Una sola pipeline por defecto por tienda. Prisma no expresa índices
-- parciales: este índice vive solo aquí (ver comentario del modelo).
CREATE UNIQUE INDEX IF NOT EXISTS "crm_pipelines_one_default_per_store" ON "crm_pipelines"("store_id") WHERE "is_default";

-- FKs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_conversations_store_id_fkey') THEN
    ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_conversations_customer_id_fkey') THEN
    ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_conversations_social_channel_id_fkey') THEN
    ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_social_channel_id_fkey" FOREIGN KEY ("social_channel_id") REFERENCES "social_channels"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_conversations_assigned_user_id_fkey') THEN
    ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_messages_store_id_fkey') THEN
    ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_messages_conversation_id_fkey') THEN
    ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "crm_conversations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_messages_sent_by_user_id_fkey') THEN
    ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_messages_campaign_id_fkey') THEN
    ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "crm_campaigns"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_messages_webhook_event_id_fkey') THEN
    ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_webhook_event_id_fkey" FOREIGN KEY ("webhook_event_id") REFERENCES "social_webhook_events"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_tags_store_id_fkey') THEN
    ALTER TABLE "crm_tags" ADD CONSTRAINT "crm_tags_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_customer_tags_store_id_fkey') THEN
    ALTER TABLE "crm_customer_tags" ADD CONSTRAINT "crm_customer_tags_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_customer_tags_customer_id_fkey') THEN
    ALTER TABLE "crm_customer_tags" ADD CONSTRAINT "crm_customer_tags_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_customer_tags_tag_id_fkey') THEN
    ALTER TABLE "crm_customer_tags" ADD CONSTRAINT "crm_customer_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "crm_tags"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_customer_tags_created_by_user_id_fkey') THEN
    ALTER TABLE "crm_customer_tags" ADD CONSTRAINT "crm_customer_tags_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_segments_store_id_fkey') THEN
    ALTER TABLE "crm_segments" ADD CONSTRAINT "crm_segments_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_segments_created_by_user_id_fkey') THEN
    ALTER TABLE "crm_segments" ADD CONSTRAINT "crm_segments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_pipelines_store_id_fkey') THEN
    ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_pipeline_stages_store_id_fkey') THEN
    ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_pipeline_stages_pipeline_id_fkey') THEN
    ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_opportunities_store_id_fkey') THEN
    ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_opportunities_customer_id_fkey') THEN
    ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_opportunities_pipeline_id_fkey') THEN
    ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_opportunities_stage_id_fkey') THEN
    ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_opportunities_owner_user_id_fkey') THEN
    ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_opportunities_quotation_id_fkey') THEN
    ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_opportunities_order_id_fkey') THEN
    ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_tasks_store_id_fkey') THEN
    ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_tasks_customer_id_fkey') THEN
    ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_tasks_opportunity_id_fkey') THEN
    ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_tasks_conversation_id_fkey') THEN
    ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "crm_conversations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_tasks_assigned_user_id_fkey') THEN
    ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_tasks_created_by_user_id_fkey') THEN
    ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_notes_store_id_fkey') THEN
    ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_notes_customer_id_fkey') THEN
    ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_notes_created_by_user_id_fkey') THEN
    ALTER TABLE "crm_notes" ADD CONSTRAINT "crm_notes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_campaigns_store_id_fkey') THEN
    ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_campaigns_segment_id_fkey') THEN
    ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "crm_segments"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_campaigns_created_by_user_id_fkey') THEN
    ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_message_templates_store_id_fkey') THEN
    ALTER TABLE "crm_message_templates" ADD CONSTRAINT "crm_message_templates_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_message_templates_social_channel_id_fkey') THEN
    ALTER TABLE "crm_message_templates" ADD CONSTRAINT "crm_message_templates_social_channel_id_fkey" FOREIGN KEY ("social_channel_id") REFERENCES "social_channels"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_users_crm_stage_id_fkey') THEN
    ALTER TABLE "store_users" ADD CONSTRAINT "store_users_crm_stage_id_fkey" FOREIGN KEY ("crm_stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
