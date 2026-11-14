-- DATA IMPACT: none (schema only, additive)
-- Tables affected: bulk_upload_logs (NEW table, three indexes, one FK to users)
-- Expected row changes: 0 (no existing table or row is read or modified)
-- Destructive operations: none (no DROP, TRUNCATE, DELETE or UPDATE)
-- FK/cascade risk: user_id -> users ON DELETE SET NULL; no FK to stores and no CASCADE
-- Idempotency: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, guarded FK via pg_constraint
-- Purpose: QUI-1004 lightweight log, one row per bulk upload (no file or per-row detail stored)

CREATE TABLE IF NOT EXISTS "bulk_upload_logs" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "upload_type" VARCHAR(40) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_hash" VARCHAR(64) NOT NULL,
    "session_id" VARCHAR(64),
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "successful_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL,
    "result_reference" VARCHAR(120),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_upload_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "bulk_upload_logs_store_id_upload_type_file_hash_idx"
  ON "bulk_upload_logs"("store_id", "upload_type", "file_hash");

CREATE INDEX IF NOT EXISTS "bulk_upload_logs_store_id_created_at_idx"
  ON "bulk_upload_logs"("store_id", "created_at");

CREATE INDEX IF NOT EXISTS "bulk_upload_logs_store_id_session_id_idx"
  ON "bulk_upload_logs"("store_id", "session_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bulk_upload_logs_user_id_fkey'
  ) THEN
    ALTER TABLE "bulk_upload_logs"
      ADD CONSTRAINT "bulk_upload_logs_user_id_fkey"
      FOREIGN KEY ("user_id")
      REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
