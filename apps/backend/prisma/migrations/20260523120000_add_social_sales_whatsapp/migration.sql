-- CreateTable
CREATE TABLE IF NOT EXISTS "social_channels" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "channel_type" VARCHAR(30) NOT NULL DEFAULT 'whatsapp',
  "provider" VARCHAR(30) NOT NULL DEFAULT 'meta_cloud',
  "status" VARCHAR(30) NOT NULL DEFAULT 'disconnected',
  "waba_id" VARCHAR(100),
  "phone_number_id" VARCHAR(100),
  "display_phone_number" VARCHAR(30),
  "business_account_id" VARCHAR(100),
  "access_token_encrypted" TEXT,
  "token_type" VARCHAR(30),
  "token_expires_at" TIMESTAMP(6),
  "metadata" JSONB,
  "last_error" TEXT,
  "connected_at" TIMESTAMP(6),
  "disconnected_at" TIMESTAMP(6),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_webhook_events" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER,
  "social_channel_id" INTEGER,
  "provider" VARCHAR(30) NOT NULL DEFAULT 'meta_cloud',
  "event_type" VARCHAR(60) NOT NULL DEFAULT 'unknown',
  "provider_message_id" VARCHAR(120),
  "payload" JSONB NOT NULL,
  "processing_status" VARCHAR(30) NOT NULL DEFAULT 'received',
  "error" TEXT,
  "received_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(6),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_channels_store_id_channel_type_provider_key"
  ON "social_channels"("store_id", "channel_type", "provider");

CREATE INDEX IF NOT EXISTS "social_channels_store_id_status_idx"
  ON "social_channels"("store_id", "status");

CREATE INDEX IF NOT EXISTS "social_channels_waba_id_idx"
  ON "social_channels"("waba_id");

CREATE INDEX IF NOT EXISTS "social_channels_phone_number_id_idx"
  ON "social_channels"("phone_number_id");

CREATE INDEX IF NOT EXISTS "social_webhook_events_store_id_received_at_idx"
  ON "social_webhook_events"("store_id", "received_at");

CREATE INDEX IF NOT EXISTS "social_webhook_events_social_channel_id_idx"
  ON "social_webhook_events"("social_channel_id");

CREATE INDEX IF NOT EXISTS "social_webhook_events_event_type_idx"
  ON "social_webhook_events"("event_type");

CREATE INDEX IF NOT EXISTS "social_webhook_events_provider_message_id_idx"
  ON "social_webhook_events"("provider_message_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_channels_store_id_fkey'
  ) THEN
    ALTER TABLE "social_channels"
      ADD CONSTRAINT "social_channels_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_webhook_events_store_id_fkey'
  ) THEN
    ALTER TABLE "social_webhook_events"
      ADD CONSTRAINT "social_webhook_events_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_webhook_events_social_channel_id_fkey'
  ) THEN
    ALTER TABLE "social_webhook_events"
      ADD CONSTRAINT "social_webhook_events_social_channel_id_fkey"
      FOREIGN KEY ("social_channel_id") REFERENCES "social_channels"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
