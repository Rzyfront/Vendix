-- CreateTable: social_conversations
CREATE TABLE IF NOT EXISTS "social_conversations" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "social_channel_id" INTEGER NOT NULL,
  "contact_phone" VARCHAR(30) NOT NULL,
  "contact_name" VARCHAR(120),
  "last_message_at" TIMESTAMP(6),
  "unread_count" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(20) NOT NULL DEFAULT 'open',
  "ai_agent_active" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: social_messages
CREATE TABLE IF NOT EXISTS "social_messages" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "social_conversation_id" INTEGER NOT NULL,
  "direction" VARCHAR(10) NOT NULL,
  "message_type" VARCHAR(20) NOT NULL DEFAULT 'text',
  "body" TEXT,
  "provider_message_id" VARCHAR(120),
  "provider_status" VARCHAR(30),
  "raw_payload" JSONB,
  "sent_at" TIMESTAMP(6),
  "delivered_at" TIMESTAMP(6),
  "read_at" TIMESTAMP(6),
  "processed_at" TIMESTAMP(6),
  "error" TEXT,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: social_conversations unique channel+phone
CREATE UNIQUE INDEX IF NOT EXISTS "social_conversations_social_channel_id_contact_phone_key"
  ON "social_conversations"("social_channel_id", "contact_phone");

-- CreateIndex: social_conversations by store + last message
CREATE INDEX IF NOT EXISTS "social_conversations_store_id_last_message_at_idx"
  ON "social_conversations"("store_id", "last_message_at");

-- CreateIndex: social_conversations by store + status
CREATE INDEX IF NOT EXISTS "social_conversations_store_id_status_idx"
  ON "social_conversations"("store_id", "status");

-- CreateIndex: social_conversations by store + unread count
CREATE INDEX IF NOT EXISTS "social_conversations_store_id_unread_count_idx"
  ON "social_conversations"("store_id", "unread_count");

-- CreateIndex: social_messages by conversation + created_at
CREATE INDEX IF NOT EXISTS "social_messages_social_conversation_id_created_at_idx"
  ON "social_messages"("social_conversation_id", "created_at");

-- CreateIndex: social_messages by store + direction + created_at
CREATE INDEX IF NOT EXISTS "social_messages_store_id_direction_created_at_idx"
  ON "social_messages"("store_id", "direction", "created_at");

-- CreateIndex: social_messages by provider_message_id
CREATE INDEX IF NOT EXISTS "social_messages_provider_message_id_idx"
  ON "social_messages"("provider_message_id");

-- AddForeignKey: social_conversations.store_id -> stores.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_conversations_store_id_fkey'
  ) THEN
    ALTER TABLE "social_conversations"
      ADD CONSTRAINT "social_conversations_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey: social_conversations.social_channel_id -> social_channels.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_conversations_social_channel_id_fkey'
  ) THEN
    ALTER TABLE "social_conversations"
      ADD CONSTRAINT "social_conversations_social_channel_id_fkey"
      FOREIGN KEY ("social_channel_id") REFERENCES "social_channels"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey: social_messages.store_id -> stores.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_messages_store_id_fkey'
  ) THEN
    ALTER TABLE "social_messages"
      ADD CONSTRAINT "social_messages_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey: social_messages.social_conversation_id -> social_conversations.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_messages_social_conversation_id_fkey'
  ) THEN
    ALTER TABLE "social_messages"
      ADD CONSTRAINT "social_messages_social_conversation_id_fkey"
      FOREIGN KEY ("social_conversation_id") REFERENCES "social_conversations"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
