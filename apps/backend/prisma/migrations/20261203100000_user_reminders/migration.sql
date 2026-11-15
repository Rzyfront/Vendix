-- ============================================================================
-- QUI-580 — Bitácora de recordatorios: tabla `user_reminders` + enums
-- ============================================================================
-- DATA IMPACT:
-- Tables affected: user_reminders (CREATE, new table). No ALTER on existing
--   tables; `stores` and `users` only gain Prisma back-relations.
-- Enums: user_reminder_status_enum, user_reminder_source_enum (CREATE);
--   notification_type_enum gains the value 'reminder_due' (ADD VALUE).
-- Expected row changes: +0 rows. New table starts empty; no existing row is
--   read, updated or deleted.
-- Destructive operations: none
-- FK/cascade risk: none. user_reminders.store_id -> stores.id and
--   user_reminders.user_id -> users.id use ON DELETE RESTRICT (no cascade).
-- Idempotency: CREATE TYPE guarded by pg_type, CREATE TABLE / CREATE INDEX
--   IF NOT EXISTS, FKs guarded by pg_constraint, ADD VALUE IF NOT EXISTS.
-- Skill: vendix-prisma-migrations (additive only).
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_reminder_status_enum') THEN
    CREATE TYPE "user_reminder_status_enum" AS ENUM ('pending', 'done');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_reminder_source_enum') THEN
    CREATE TYPE "user_reminder_source_enum" AS ENUM ('manual', 'vex');
  END IF;
END $$;

-- Not used by any statement of this migration, so it is safe next to them.
ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'reminder_due';

CREATE TABLE IF NOT EXISTS "user_reminders" (
  "id"           SERIAL                       NOT NULL,
  "store_id"     INTEGER                      NOT NULL,
  "user_id"      INTEGER                      NOT NULL,
  "title"        VARCHAR(200)                 NOT NULL,
  "note"         VARCHAR(500),
  "remind_at"    TIMESTAMP(6),
  "status"       "user_reminder_status_enum"  NOT NULL DEFAULT 'pending',
  "link_type"    VARCHAR(20),
  "link_id"      INTEGER,
  "link_label"   VARCHAR(200),
  "source"       "user_reminder_source_enum"  NOT NULL DEFAULT 'manual',
  "notified_at"  TIMESTAMP(6),
  "completed_at" TIMESTAMP(6),
  "created_at"   TIMESTAMP(6)                 NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(6)                 NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_reminders_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_reminders_store_id_fkey'
  ) THEN
    ALTER TABLE "user_reminders"
      ADD CONSTRAINT "user_reminders_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_reminders_user_id_fkey'
  ) THEN
    ALTER TABLE "user_reminders"
      ADD CONSTRAINT "user_reminders_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "user_reminders_store_id_user_id_status_remind_at_idx"
  ON "user_reminders"("store_id", "user_id", "status", "remind_at");
CREATE INDEX IF NOT EXISTS "user_reminders_status_notified_at_remind_at_idx"
  ON "user_reminders"("status", "notified_at", "remind_at");
