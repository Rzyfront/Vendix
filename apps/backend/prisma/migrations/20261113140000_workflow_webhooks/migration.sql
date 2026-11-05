-- flujos-documental S13 (bloque 13): webhooks salientes firmados de Flujos.
-- Tablas nuevas `workflow_webhook_endpoints` (URL + secreto de firma CIFRADO) y
-- `workflow_webhook_deliveries` (panel de entregas; el reintento lo gobierna
-- workflow_outbox con kind 'webhook').
--
-- DATA IMPACT:
-- Tables affected: workflow_webhook_endpoints (NUEVA), workflow_webhook_deliveries (NUEVA).
-- Expected row changes: +0 (solo esquema; ninguna fila existente se lee ni se muta).
-- Destructive operations: none (sin DROP / TRUNCATE / UPDATE / DELETE).
-- FK/cascade risk: FKs nuevas hacia organizations / stores / users y entre las
--   dos tablas nuevas, todas ON DELETE RESTRICT; ningún CASCADE.
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS, FKs guardadas por pg_constraint.
-- Skill: vendix-prisma-migrations.

-- CreateTable
CREATE TABLE IF NOT EXISTS "workflow_webhook_endpoints" (
    "id" SERIAL NOT NULL,
    "organization_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "event_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" VARCHAR(200),
    "created_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "workflow_webhook_deliveries" (
    "id" BIGSERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "endpoint_id" INTEGER NOT NULL,
    "event_id" VARCHAR(40) NOT NULL,
    "event_type" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status_code" INTEGER,
    "last_error" TEXT,
    "next_retry_at" TIMESTAMP(6),
    "delivered_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_webhook_endpoints_store_id_is_active_idx" ON "workflow_webhook_endpoints"("store_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_webhook_deliveries_endpoint_id_event_id_key" ON "workflow_webhook_deliveries"("endpoint_id", "event_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_webhook_deliveries_store_id_created_at_idx" ON "workflow_webhook_deliveries"("store_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_webhook_deliveries_status_next_retry_at_idx" ON "workflow_webhook_deliveries"("status", "next_retry_at");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_webhook_endpoints_organization_id_fkey') THEN
    ALTER TABLE "workflow_webhook_endpoints" ADD CONSTRAINT "workflow_webhook_endpoints_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_webhook_endpoints_store_id_fkey') THEN
    ALTER TABLE "workflow_webhook_endpoints" ADD CONSTRAINT "workflow_webhook_endpoints_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_webhook_endpoints_created_by_user_id_fkey') THEN
    ALTER TABLE "workflow_webhook_endpoints" ADD CONSTRAINT "workflow_webhook_endpoints_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_webhook_deliveries_store_id_fkey') THEN
    ALTER TABLE "workflow_webhook_deliveries" ADD CONSTRAINT "workflow_webhook_deliveries_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_webhook_deliveries_endpoint_id_fkey') THEN
    ALTER TABLE "workflow_webhook_deliveries" ADD CONSTRAINT "workflow_webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "workflow_webhook_endpoints"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
