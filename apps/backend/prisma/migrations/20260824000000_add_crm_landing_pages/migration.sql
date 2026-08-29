-- ============================================================================
-- QUI-719 — CRM Landing: modelo `crm_landing_pages` + enum de estado
-- ============================================================================
-- DATA IMPACT:
-- Tables affected: crm_landing_pages (CREATE), stores (back-relation only,
--   no ALTER on the parent — Prisma resolves the 1:1 from the child FK).
-- Expected row changes: +0 rows. Tabla nueva, arranca vacía.
-- Destructive operations: none
-- FK/cascade risk: `crm_landing_pages.store_id -> stores.id` con
--   ON DELETE CASCADE: borrar una tienda borra su landing (comportamiento
--   deseado — la landing no sobrevive a su tienda).
-- Idempotency: CREATE TYPE guardado por DO $$ + pg_type, CREATE TABLE /
--   CREATE UNIQUE INDEX / CREATE INDEX con IF NOT EXISTS.
-- Skill: vendix-prisma-migrations (anti-destructivo + idempotencia).
--
-- Contrato del modelo:
--   * 1:1 con la tienda (`store_id @unique`) — una sola landing por tienda.
--   * `content_json` = draft editable en el panel; `published_json` =
--     copia inmutable servida públicamente (se llena al publicar).
--   * `generation_status`: idle -> pending -> generating -> ready | failed.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'crm_generation_status_enum') THEN
    CREATE TYPE "crm_generation_status_enum" AS ENUM ('idle', 'pending', 'generating', 'ready', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "crm_landing_pages" (
  "id"                    SERIAL                        NOT NULL,
  "store_id"              INTEGER                       NOT NULL,
  "enabled"               BOOLEAN                       NOT NULL DEFAULT false,
  "content_json"          JSONB,
  "published_json"        JSONB,
  "published_at"          TIMESTAMP(6),
  "version"               INTEGER                       NOT NULL DEFAULT 0,
  "generation_status"     "crm_generation_status_enum"  NOT NULL DEFAULT 'idle',
  "last_job_id"           VARCHAR(64),
  "last_generation_error" TEXT,
  "created_at"            TIMESTAMP(6)                  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(6)                  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crm_landing_pages_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_landing_pages_store_id_fkey'
  ) THEN
    ALTER TABLE "crm_landing_pages"
      ADD CONSTRAINT "crm_landing_pages_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "crm_landing_pages_store_id_key" ON "crm_landing_pages"("store_id");
CREATE INDEX IF NOT EXISTS "crm_landing_pages_enabled_idx" ON "crm_landing_pages"("enabled");
