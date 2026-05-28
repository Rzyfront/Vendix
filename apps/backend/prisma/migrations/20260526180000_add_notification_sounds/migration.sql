-- DATA IMPACT:
-- Tables affected: notification_sounds (new global catalog table)
-- Expected row count change: 0 (empty table; rows added later via super-admin UI)
-- Destructive operations: none (no DROP, no TRUNCATE, no CASCADE, no unscoped DELETE/UPDATE)
-- FK/cascade risk: none (global catalog, referenced logically from store_settings JSON
--                  field `notifications.sound_id` -- no Prisma relation, no FK constraint)
-- Idempotency: guarded with CREATE TABLE IF NOT EXISTS and CREATE [UNIQUE] INDEX IF NOT EXISTS
-- Approval: Step 1 of approved plan .claude/plans/notification-sounds-feature.md

CREATE TABLE IF NOT EXISTS "notification_sounds" (
  "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
  "name"            VARCHAR(120) NOT NULL,
  "s3_key"          VARCHAR(255) NOT NULL,
  "mime_type"       VARCHAR(60)  NOT NULL,
  "file_size_bytes" INTEGER      NOT NULL,
  "is_active"       BOOLEAN      NOT NULL DEFAULT true,
  "sort_order"      INTEGER      NOT NULL DEFAULT 0,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_sounds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_sounds_s3_key_key"
  ON "notification_sounds" ("s3_key");

CREATE INDEX IF NOT EXISTS "notification_sounds_is_active_sort_order_idx"
  ON "notification_sounds" ("is_active", "sort_order");
