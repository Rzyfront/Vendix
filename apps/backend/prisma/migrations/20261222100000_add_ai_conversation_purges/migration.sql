-- =====================================================
-- ai_conversation_purges — constancia del borrado físico de conversaciones de Vex
-- =====================================================
-- DATA IMPACT: 0 filas modificadas, 0 insertadas, 0 eliminadas.
-- - Tabla NUEVA ai_conversation_purges (vacía). Sin título ni contenido de la
--   conversación: solo quién, cuándo, conteos y la lista de objetos S3 pendientes.
-- - ai_agent_effects.objective_id pasa a ser NULLABLE (DROP NOT NULL). Es un
--   cambio solo de esquema: ninguna fila cambia. Permite que, al borrar una
--   conversación, los efectos YA APLICADOS en el negocio se conserven
--   desvinculados (objective_id = NULL, hecho en runtime por
--   ConversationPurgeService) en vez de borrarse. El FK compuesto
--   (objective_id, store_id, organization_id, user_id) no se modifica: con una
--   columna NULL no se aplica (MATCH SIMPLE) y las filas con objetivo siguen
--   protegidas por ON DELETE RESTRICT. No se usa ON DELETE SET NULL porque en un
--   FK compuesto anularía también store_id/organization_id/user_id (NOT NULL).
-- - Operaciones destructivas: NINGUNA. Sin DELETE / TRUNCATE / DROP / CASCADE.
--   Sin UPDATE.
-- - FK/cascade risk: la tabla nueva no tiene FK a propósito (la conversación ya
--   no existe cuando se escribe la constancia).
-- - Idempotencia: CREATE TABLE/INDEX IF NOT EXISTS; DROP NOT NULL es no-op si ya
--   es nullable.
-- - Reversibilidad: DROP TABLE solo si está vacía (renombrar a
--   _deprecated_YYYYMMDD si tiene constancias); ALTER COLUMN objective_id SET
--   NOT NULL solo si no hay efectos desvinculados.
-- - Approval: odd/tasks/vex-agente-avanzado.md, T4 (M1).
-- =====================================================

CREATE TABLE IF NOT EXISTS "ai_conversation_purges" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "conversation_id" INTEGER NOT NULL,
  "agent_key" VARCHAR(80) NOT NULL,
  "counts" JSONB NOT NULL,
  "pending_s3_keys" JSONB NOT NULL DEFAULT '[]',
  "s3_attempts" INTEGER NOT NULL DEFAULT 0,
  "s3_completed_at" TIMESTAMP(6),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_conversation_purges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_conversation_purges_store_id_idx"
  ON "ai_conversation_purges" ("store_id");

CREATE INDEX IF NOT EXISTS "ai_conversation_purges_s3_completed_at_s3_attempts_idx"
  ON "ai_conversation_purges" ("s3_completed_at", "s3_attempts");

ALTER TABLE "ai_agent_effects" ALTER COLUMN "objective_id" DROP NOT NULL;
