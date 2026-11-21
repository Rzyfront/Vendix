-- =====================================================
-- ai_agent_write_batches — lotes de escritura de Vex (F5, M9)
-- =====================================================
-- DATA IMPACT: none. 0 filas modificadas, 0 insertadas, 0 eliminadas.
-- - Tabla NUEVA ai_agent_write_batches (vacía): un lote = hasta 25 escrituras
--   reversibles que la persona aprueba con un clic.
-- - ai_agent_effects.batch_id: columna NUEVA, NULLABLE, sin default. Ninguna
--   fila existente cambia (queda NULL).
-- - conversation_id es un entero plano SIN FK a propósito: la conversación se
--   puede borrar físicamente (purga de F1) y el lote ya aplicado debe sobrevivir.
-- - FK ai_agent_effects.batch_id -> ai_agent_write_batches(id) con
--   ON DELETE RESTRICT ON UPDATE RESTRICT: un lote con efectos no se puede borrar.
--   Nunca CASCADE.
-- - Operaciones destructivas: NINGUNA. Sin DELETE / UPDATE / TRUNCATE / DROP / CASCADE.
-- - Idempotencia: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS y
--   la FK se crea solo si pg_constraint no la tiene.
-- - Reversibilidad: DROP TABLE solo si está vacía (si tiene lotes, renombrar a
--   _deprecated_YYYYMMDD); ALTER TABLE ai_agent_effects DROP COLUMN batch_id solo
--   si ninguna fila la usa.
-- - Approval: odd/tasks/vex-agente-avanzado.md, T34 (M9).
-- =====================================================

CREATE TABLE IF NOT EXISTS "ai_agent_write_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" INTEGER NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "conversation_id" INTEGER,
  "goal" VARCHAR(500) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'proposed',
  "steps" JSONB NOT NULL DEFAULT '[]',
  "step_count" INTEGER NOT NULL,
  "affected_records" INTEGER NOT NULL DEFAULT 0,
  "part_index" INTEGER NOT NULL DEFAULT 1,
  "part_total" INTEGER NOT NULL DEFAULT 1,
  "group_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 0,
  "approved_by_user_id" INTEGER,
  "approved_at" TIMESTAMPTZ(6),
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "summary" JSONB,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "ai_agent_write_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_agent_write_batches_owner_status_idx"
  ON "ai_agent_write_batches" ("store_id", "organization_id", "user_id", "status");

CREATE INDEX IF NOT EXISTS "ai_agent_write_batches_conversation_id_idx"
  ON "ai_agent_write_batches" ("conversation_id");

ALTER TABLE "ai_agent_effects" ADD COLUMN IF NOT EXISTS "batch_id" UUID;

CREATE INDEX IF NOT EXISTS "ai_agent_effects_batch_id_idx"
  ON "ai_agent_effects" ("batch_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_agent_effects_batch_id_fkey'
  ) THEN
    ALTER TABLE "ai_agent_effects"
      ADD CONSTRAINT "ai_agent_effects_batch_id_fkey"
      FOREIGN KEY ("batch_id") REFERENCES "ai_agent_write_batches"("id")
      ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END $$;
