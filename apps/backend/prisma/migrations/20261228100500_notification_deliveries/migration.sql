-- Recordatorios y notificaciones (odd/tasks/recordatorios-notificaciones.md
-- §3.1c, §4.2 punto 2) — tabla `notification_deliveries`: outbox por
-- destinatario y canal de los avisos personales. Garantiza "una sola vez" por
-- (tienda, usuario, canal, dedupe_key), da reintentos con backoff al correo y
-- deja auditoría de qué le llegó a quién. La drena `NotificationDeliveriesJob`
-- (solo worker) con `FOR UPDATE SKIP LOCKED`.
--
-- DATA IMPACT:
--   Tables affected: notification_deliveries (NEW, vacía). Ninguna tabla
--     existente cambia.
--   Expected row changes: 0. Sin DML (no INSERT/UPDATE/DELETE).
--   Destructive operations: none. Sin DROP ni TRUNCATE.
--   FK/cascade risk: store_id -> stores ON DELETE RESTRICT. user_id -> users
--     ON DELETE CASCADE (igual que notification_subscriptions y
--     push_subscriptions: borrar un usuario solo borra su bitácora de entregas,
--     nunca datos de negocio). notification_id -> notifications ON DELETE SET
--     NULL (la entrega sobrevive a la limpieza de la campana). La tabla no
--     tiene hijos.
--   Idempotency: CREATE TYPE guardado con pg_type, CREATE TABLE/INDEX IF NOT
--     EXISTS y FKs guardadas con pg_constraint. Correrla dos veces no hace nada.
--   Approval: esquema aditivo del plan aprobado por Rafael (2026-11-23, §6).
-- Skill: vendix-prisma-migrations.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_channel_enum') THEN
    CREATE TYPE "notification_channel_enum" AS ENUM ('push', 'email');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_delivery_status_enum') THEN
    CREATE TYPE "notification_delivery_status_enum" AS ENUM ('pending', 'sent', 'failed', 'skipped');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "notification_deliveries" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "notification_id" INTEGER,
    "user_id" INTEGER NOT NULL,
    "channel" "notification_channel_enum" NOT NULL,
    "type" "notification_type_enum" NOT NULL,
    "dedupe_key" VARCHAR(191) NOT NULL,
    "status" "notification_delivery_status_enum" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(6),
    "error" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_store_id_user_id_channel_dedupe_key_key"
    ON "notification_deliveries"("store_id", "user_id", "channel", "dedupe_key");

CREATE INDEX IF NOT EXISTS "notification_deliveries_status_next_attempt_at_idx"
    ON "notification_deliveries"("status", "next_attempt_at");

CREATE INDEX IF NOT EXISTS "notification_deliveries_store_id_created_at_idx"
    ON "notification_deliveries"("store_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "notification_deliveries_notification_id_idx"
    ON "notification_deliveries"("notification_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_deliveries_store_id_fkey') THEN
    ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_deliveries_user_id_fkey') THEN
    ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_deliveries_notification_id_fkey') THEN
    ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
