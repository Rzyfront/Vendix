-- Apps · Fase 0 (odd/tasks/apps-module.md, S1/T1): catálogo de apps por tienda.
--
-- DATA IMPACT:
--   Tables affected: ninguna existente mutada. Tabla nueva store_apps (vacía),
--     tipos nuevos app_kind_enum y app_status_enum, y 4 valores nuevos en
--     app_type_enum (STORE_HOME, STORE_PRODUCT_PAGE, STORE_SERVICE_PAGE,
--     STORE_BOOKING). Ningún valor existente se renombra ni se quita.
--   Expected row changes: 0. Sin DML.
--   Destructive operations: ninguna. Sin DROP, TRUNCATE, UPDATE, DELETE.
--   FK/cascade risk: store_apps.store_id -> stores ON DELETE CASCADE (store_apps
--     es hija; no se agrega CASCADE a ningún padre con datos de negocio).
--     store_apps.domain_settings_id -> domain_settings ON DELETE SET NULL.
--   Idempotency: pg_type / pg_constraint guards, IF NOT EXISTS en tabla,
--     índices y valores de enum. Los valores nuevos de app_type_enum no se
--     usan en esta migración. El backfill va en la migración siguiente.
--   Approval: plan apps-module aprobado por Rafael (brief Fase 0, 2026-11-01).

-- AlterEnum (aditivo)
ALTER TYPE "app_type_enum" ADD VALUE IF NOT EXISTS 'STORE_HOME';
ALTER TYPE "app_type_enum" ADD VALUE IF NOT EXISTS 'STORE_PRODUCT_PAGE';
ALTER TYPE "app_type_enum" ADD VALUE IF NOT EXISTS 'STORE_SERVICE_PAGE';
ALTER TYPE "app_type_enum" ADD VALUE IF NOT EXISTS 'STORE_BOOKING';

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_kind_enum') THEN
    CREATE TYPE "app_kind_enum" AS ENUM ('ecommerce', 'store_home', 'landing', 'product_page', 'service_page', 'booking');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_status_enum') THEN
    CREATE TYPE "app_status_enum" AS ENUM ('not_installed', 'draft', 'published', 'disabled');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "store_apps" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "kind" "app_kind_enum" NOT NULL,
    "status" "app_status_enum" NOT NULL DEFAULT 'not_installed',
    "domain_settings_id" INTEGER,
    "config" JSONB NOT NULL DEFAULT '{}',
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_apps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "store_apps_store_id_idx" ON "store_apps"("store_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "store_apps_kind_status_idx" ON "store_apps"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "store_apps_store_id_kind_key" ON "store_apps"("store_id", "kind");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_apps_store_id_fkey') THEN
    ALTER TABLE "store_apps" ADD CONSTRAINT "store_apps_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_apps_domain_settings_id_fkey') THEN
    ALTER TABLE "store_apps" ADD CONSTRAINT "store_apps_domain_settings_id_fkey" FOREIGN KEY ("domain_settings_id") REFERENCES "domain_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
