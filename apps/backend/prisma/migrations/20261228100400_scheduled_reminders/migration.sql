-- Recordatorios y notificaciones (odd/tasks/recordatorios-notificaciones.md
-- §3.1b, §4.2 punto 1) — tabla `scheduled_reminders`: disparos futuros de
-- avisos con fecha (por vencer, vencida, escalamiento, resumen). La escribe
-- `ReminderScheduler.sync` (F1) y la drena un cron del worker con
-- `FOR UPDATE SKIP LOCKED`. Cada fila nombra su tienda.
--
-- DATA IMPACT:
--   Tables affected: scheduled_reminders (NEW, vacía). Ninguna tabla existente
--     cambia.
--   Expected row changes: 0. Sin DML (no INSERT/UPDATE/DELETE).
--   Destructive operations: none. Sin DROP ni TRUNCATE.
--   FK/cascade risk: store_id -> stores ON DELETE RESTRICT (igual que
--     crm_tasks). La tabla no tiene hijos.
--   Idempotency: CREATE TYPE guardado con pg_type, CREATE TABLE/INDEX IF NOT
--     EXISTS y FK guardada con pg_constraint. Correrla dos veces no hace nada.
--   Approval: esquema aditivo del plan aprobado por Rafael (2026-11-23, §6).
-- Skill: vendix-prisma-migrations.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scheduled_reminder_status_enum') THEN
    CREATE TYPE "scheduled_reminder_status_enum" AS ENUM ('pending', 'sent', 'cancelled', 'skipped');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "scheduled_reminders" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "source_type" VARCHAR(40) NOT NULL,
    "source_id" INTEGER NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "fire_at" TIMESTAMP(6) NOT NULL,
    "recipients" JSONB,
    "status" "scheduled_reminder_status_enum" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_reminders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_reminders_source_type_source_id_kind_fire_at_key"
    ON "scheduled_reminders"("source_type", "source_id", "kind", "fire_at");

CREATE INDEX IF NOT EXISTS "scheduled_reminders_status_fire_at_idx"
    ON "scheduled_reminders"("status", "fire_at");

CREATE INDEX IF NOT EXISTS "scheduled_reminders_store_id_idx"
    ON "scheduled_reminders"("store_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_reminders_store_id_fkey') THEN
    ALTER TABLE "scheduled_reminders" ADD CONSTRAINT "scheduled_reminders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
