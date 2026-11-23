-- =====================================================
-- M5 (Vex Plus F3) — compactación de contexto y modelo de respaldo
-- =====================================================
-- DATA IMPACT: 0 filas modificadas, 0 insertadas, 0 eliminadas.
-- - ai_conversations.summary_through_message_id (INTEGER NULL, columna NUEVA):
--   id del último ai_messages cubierto por ai_conversations.summary. Todas las
--   filas existentes quedan en NULL (= sin resumen). Sin FK a propósito: los
--   mensajes solo se borran junto con su conversación.
-- - ai_engine_applications.fallback_config_id (INTEGER NULL, columna NUEVA) con
--   FK a ai_engine_configs(id) ON DELETE SET NULL: borrar una configuración
--   solo deja a la aplicación sin respaldo; no borra ni modifica aplicaciones.
--   Todas las filas existentes quedan en NULL (= sin respaldo, comportamiento
--   idéntico al actual).
-- - Índice nuevo sobre fallback_config_id.
-- - Operaciones destructivas: NINGUNA. Sin DELETE / TRUNCATE / DROP / CASCADE.
--   Sin UPDATE.
-- - Idempotencia: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS y FK
--   guardada con pg_constraint.
-- - Reversibilidad: DROP CONSTRAINT + DROP COLUMN solo mientras las columnas
--   sigan vacías (sin datos productivos).
-- - Plan: odd/tasks/vex-agente-avanzado.md, §3.9 (M5), tareas T22 y T24.
-- =====================================================

ALTER TABLE "ai_conversations"
  ADD COLUMN IF NOT EXISTS "summary_through_message_id" INTEGER;

ALTER TABLE "ai_engine_applications"
  ADD COLUMN IF NOT EXISTS "fallback_config_id" INTEGER;

CREATE INDEX IF NOT EXISTS "ai_engine_applications_fallback_config_id_idx"
  ON "ai_engine_applications"("fallback_config_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_engine_applications_fallback_config_id_fkey'
  ) THEN
    ALTER TABLE "ai_engine_applications"
      ADD CONSTRAINT "ai_engine_applications_fallback_config_id_fkey"
      FOREIGN KEY ("fallback_config_id") REFERENCES "ai_engine_configs"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
