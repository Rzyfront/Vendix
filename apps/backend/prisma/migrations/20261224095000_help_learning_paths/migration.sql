-- =====================================================
-- Rutas de aprendizaje + índice de ayuda (F4 · T25–T27 · M7)
-- =====================================================
-- DATA IMPACT: 0 filas modificadas, 0 insertadas, 0 eliminadas.
-- - help_articles.video_id: columna NUEVA, nullable, sin default (las filas
--   existentes quedan en NULL; no hay backfill).
-- - Tablas NUEVAS (vacías): video_series, video_series_items,
--   user_learning_progress.
-- - CHECK de tipos de conocimiento AMPLIADO (no restringido):
--   ai_knowledge_documents_scope_check y ai_embeddings_knowledge_scope_check
--   pasan de ('tool','skill','process','recipe') a esos cuatro más
--   ('help_article','help_video','learning_path'). Se reemplaza la constraint
--   (DROP CONSTRAINT + ADD) dentro de un bloque que solo actúa si la versión
--   ampliada aún no existe. Toda fila válida antes sigue siendo válida después.
--   ai_embeddings conserva NOT VALID como en su migración original
--   (20261018100000); ai_knowledge_documents se valida (tabla pequeña,
--   contenido de release: herramientas, procesos y recetas).
-- - Operaciones destructivas: NINGUNA sobre datos. Sin DELETE / UPDATE /
--   TRUNCATE / DROP TABLE / CASCADE. El único DROP es de constraints CHECK que
--   se recrean más amplias en la misma transacción.
-- - FK/cascade risk: video_series_items → video_series y → videos con
--   ON DELETE RESTRICT (la app borra los ítems explícitamente);
--   video_series_items.article_id y help_articles.video_id con ON DELETE SET
--   NULL (columnas simples, no compuestas). Ningún ON DELETE CASCADE.
-- - Idempotencia: ADD COLUMN / CREATE TABLE / INDEX IF NOT EXISTS; FKs y CHECKs
--   guardados con pg_constraint.
-- - Reversibilidad: las tablas nuevas se pueden retirar renombrándolas a
--   *_deprecated_YYYYMMDD; la columna video_id puede quedar sin uso; los CHECK
--   pueden volver a la lista de cuatro solo si no hay filas de ayuda indexadas.
-- - Plan: odd/tasks/vex-agente-avanzado.md, §3.2 y §3.9 (M7), tareas T25–T27.
-- =====================================================

ALTER TABLE "help_articles" ADD COLUMN IF NOT EXISTS "video_id" INTEGER;
CREATE INDEX IF NOT EXISTS "help_articles_video_id_idx" ON "help_articles" ("video_id");

CREATE TABLE IF NOT EXISTS "video_series" (
  "id" SERIAL NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "slug" VARCHAR(280) NOT NULL,
  "summary" VARCHAR(500),
  "description" TEXT,
  "module" VARCHAR(50),
  "thumbnail_url" TEXT,
  "status" "video_status_enum" NOT NULL DEFAULT 'DRAFT',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" INTEGER,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "video_series_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "video_series_slug_key" ON "video_series" ("slug");
CREATE INDEX IF NOT EXISTS "video_series_status_idx" ON "video_series" ("status");
CREATE INDEX IF NOT EXISTS "video_series_module_idx" ON "video_series" ("module");

CREATE TABLE IF NOT EXISTS "video_series_items" (
  "id" SERIAL NOT NULL,
  "series_id" INTEGER NOT NULL,
  "video_id" INTEGER NOT NULL,
  "article_id" INTEGER,
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "video_series_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "video_series_items_series_id_video_id_key"
  ON "video_series_items" ("series_id", "video_id");
CREATE INDEX IF NOT EXISTS "video_series_items_series_id_position_idx"
  ON "video_series_items" ("series_id", "position");
CREATE INDEX IF NOT EXISTS "video_series_items_video_id_idx"
  ON "video_series_items" ("video_id");

CREATE TABLE IF NOT EXISTS "user_learning_progress" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "series_id" INTEGER,
  "video_id" INTEGER NOT NULL,
  "seconds_watched" INTEGER NOT NULL DEFAULT 0,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "completed_at" TIMESTAMP(6),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_learning_progress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_learning_progress_user_id_video_id_key"
  ON "user_learning_progress" ("user_id", "video_id");
CREATE INDEX IF NOT EXISTS "user_learning_progress_user_id_series_id_idx"
  ON "user_learning_progress" ("user_id", "series_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'help_articles_video_id_fkey') THEN
    ALTER TABLE "help_articles" ADD CONSTRAINT "help_articles_video_id_fkey"
      FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'video_series_items_series_id_fkey') THEN
    ALTER TABLE "video_series_items" ADD CONSTRAINT "video_series_items_series_id_fkey"
      FOREIGN KEY ("series_id") REFERENCES "video_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'video_series_items_video_id_fkey') THEN
    ALTER TABLE "video_series_items" ADD CONSTRAINT "video_series_items_video_id_fkey"
      FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'video_series_items_article_id_fkey') THEN
    ALTER TABLE "video_series_items" ADD CONSTRAINT "video_series_items_article_id_fkey"
      FOREIGN KEY ("article_id") REFERENCES "help_articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Widen knowledge type CHECKs (only when the widened version is not there yet).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ai_knowledge_documents'::regclass
      AND conname = 'ai_knowledge_documents_scope_check'
      AND pg_get_constraintdef(oid) LIKE '%help_article%'
  ) THEN
    ALTER TABLE ai_knowledge_documents DROP CONSTRAINT IF EXISTS ai_knowledge_documents_scope_check;
    ALTER TABLE ai_knowledge_documents ADD CONSTRAINT ai_knowledge_documents_scope_check CHECK (
      entity_type IN ('tool','skill','process','recipe','help_article','help_video','learning_path') AND (
        (knowledge_scope = 'global' AND store_id IS NULL AND organization_id IS NULL)
        OR (knowledge_scope = 'store' AND store_id > 0 AND organization_id > 0
          AND store_id IS NOT NULL AND organization_id IS NOT NULL)));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ai_embeddings'::regclass
      AND conname = 'ai_embeddings_knowledge_scope_check'
      AND pg_get_constraintdef(oid) LIKE '%help_article%'
  ) THEN
    ALTER TABLE ai_embeddings DROP CONSTRAINT IF EXISTS ai_embeddings_knowledge_scope_check;
    ALTER TABLE ai_embeddings ADD CONSTRAINT ai_embeddings_knowledge_scope_check CHECK (
      (knowledge_scope = 'store' AND store_id > 0 AND organization_id > 0)
      OR (knowledge_scope = 'global' AND store_id = 0 AND organization_id = 0
        AND entity_type IN ('tool','skill','process','recipe','help_article','help_video','learning_path'))) NOT VALID;
  END IF;
END $$;
