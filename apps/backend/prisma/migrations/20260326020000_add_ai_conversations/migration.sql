-- CreateEnum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_conversation_status_enum') THEN
    CREATE TYPE "ai_conversation_status_enum" AS ENUM ('active', 'archived', 'deleted');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_message_role_enum') THEN
    CREATE TYPE "ai_message_role_enum" AS ENUM ('system', 'user', 'assistant', 'tool');
  END IF;
END
$$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_conversations" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" VARCHAR(255),
    "summary" TEXT,
    "app_key" VARCHAR(100),
    "status" "ai_conversation_status_enum" NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_messages" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "role" "ai_message_role_enum" NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "tokens_used" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,8) NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "ai_conversations_store_id_idx" ON "ai_conversations"("store_id");
CREATE INDEX IF NOT EXISTS "ai_conversations_store_id_user_id_idx" ON "ai_conversations"("store_id", "user_id");
CREATE INDEX IF NOT EXISTS "ai_conversations_status_idx" ON "ai_conversations"("status");
CREATE INDEX IF NOT EXISTS "ai_messages_conversation_id_idx" ON "ai_messages"("conversation_id");
CREATE INDEX IF NOT EXISTS "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
