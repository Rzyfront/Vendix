-- =====================================================
-- ai_agent_skills + ai_agent_skill_versions (F4 · T32 · M8, tablas)
-- =====================================================
-- DATA IMPACT: 0 filas modificadas, 0 insertadas, 0 eliminadas.
-- - Tablas NUEVAS (vacías): ai_agent_skills (guías «cómo se hace X en
--   Vendix», globales, editables desde superadmin) y ai_agent_skill_versions
--   (historial inmutable, solo inserción).
-- - La semilla inicial va aparte, en 20261224110000_ai_agent_skills_seed, solo
--   con inserciones idempotentes.
-- - Operaciones destructivas: NINGUNA. Sin DELETE / UPDATE / TRUNCATE / DROP /
--   CASCADE.
-- - FK/cascade risk: ai_agent_skill_versions.skill_id → ai_agent_skills.id con
--   ON DELETE RESTRICT: una skill con historial no se puede borrar (se archiva).
-- - Idempotencia: CREATE TABLE / INDEX IF NOT EXISTS; FK guardada con
--   pg_constraint.
-- - Reversibilidad: DROP TABLE solo si están vacías; con datos, renombrar a
--   *_deprecated_YYYYMMDD.
-- - Plan: odd/tasks/vex-agente-avanzado.md, §3.2 y §3.9 (M8), tareas T32–T33.
-- =====================================================

CREATE TABLE IF NOT EXISTS "ai_agent_skills" (
  "id" SERIAL NOT NULL,
  "key" VARCHAR(120) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "module" VARCHAR(50),
  "body" TEXT NOT NULL,
  "candidate_tools" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "help_article_id" INTEGER,
  "video_id" INTEGER,
  "agent_keys" TEXT[] NOT NULL DEFAULT ARRAY['vex']::TEXT[],
  "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
  "version" INTEGER NOT NULL DEFAULT 1,
  "published_version" INTEGER,
  "created_by_user_id" INTEGER,
  "updated_by_user_id" INTEGER,
  "published_at" TIMESTAMP(6),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_agent_skills_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_skills_key_key" ON "ai_agent_skills" ("key");
CREATE INDEX IF NOT EXISTS "ai_agent_skills_status_module_idx" ON "ai_agent_skills" ("status", "module");

CREATE TABLE IF NOT EXISTS "ai_agent_skill_versions" (
  "id" SERIAL NOT NULL,
  "skill_id" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "module" VARCHAR(50),
  "body" TEXT NOT NULL,
  "candidate_tools" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "help_article_id" INTEGER,
  "video_id" INTEGER,
  "agent_keys" TEXT[] NOT NULL DEFAULT ARRAY['vex']::TEXT[],
  "change_note" VARCHAR(500),
  "author_user_id" INTEGER,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_agent_skill_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_skill_versions_skill_id_version_key"
  ON "ai_agent_skill_versions" ("skill_id", "version");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_agent_skill_versions_skill_id_fkey') THEN
    ALTER TABLE "ai_agent_skill_versions" ADD CONSTRAINT "ai_agent_skill_versions_skill_id_fkey"
      FOREIGN KEY ("skill_id") REFERENCES "ai_agent_skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
