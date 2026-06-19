-- =============================================================================
-- Migration: weekly_report (Tu Semana en Vendix / Wrapped semanal)
-- Created: 2026-06-22
-- Idempotent: yes
-- Notes:
--   * Adds enum value 'weekly_report' to notification_type_enum.
--   * Adds table store_weekly_reports:
--       - one row per (store_id, week_start_date)
--       - metrics/slides/tips persisted as JSON snapshot (stable, auditable, fast)
--   * Adds reverse relation in stores model.
-- =============================================================================

-- ─── ENUM EXTENSION ──────────────────────────────────────────────────────────

ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'weekly_report';

-- ─── TABLE ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "store_weekly_reports" (
  "id"              SERIAL PRIMARY KEY,
  "store_id"        INTEGER NOT NULL,
  "week_start_date" DATE NOT NULL,
  "week_end_date"   DATE NOT NULL,
  "tier"            VARCHAR(20) NOT NULL,
  "metrics"         JSONB NOT NULL,
  "slides"          JSONB NOT NULL,
  "tips"            JSONB NOT NULL,
  "rolling_avg"     JSONB,
  "generated_at"    TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  "viewed_at"       TIMESTAMP(6),
  CONSTRAINT "store_weekly_reports_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE
);

-- One snapshot per store per week (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'store_weekly_reports_store_id_week_start_date_key'
  ) THEN
    ALTER TABLE "store_weekly_reports"
      ADD CONSTRAINT "store_weekly_reports_store_id_week_start_date_key"
      UNIQUE ("store_id", "week_start_date");
  END IF;
END $$;

-- Lookup indexes
CREATE INDEX IF NOT EXISTS "store_weekly_reports_store_id_week_start_date_idx"
  ON "store_weekly_reports" ("store_id", "week_start_date" DESC);

CREATE INDEX IF NOT EXISTS "store_weekly_reports_store_id_generated_at_idx"
  ON "store_weekly_reports" ("store_id", "generated_at" DESC);
