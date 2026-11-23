-- =====================================================
-- ai_agent_memories — memoria de la tienda para Vex (F4 · T31 · M6)
-- =====================================================
-- DATA IMPACT: 0 filas modificadas, 0 insertadas, 0 eliminadas.
-- - Tabla NUEVA ai_agent_memories (vacía). Preferencias cortas que Vex guarda
--   por tienda (estilo MEMORY.md) y que el dueño edita en Ajustes.
-- - user_id NULL = memoria de toda la tienda (hoy siempre NULL). La unicidad se
--   expresa con dos índices únicos parciales (NULL nunca es igual a NULL en un
--   UNIQUE normal): uno para user_id IS NULL y otro para user_id IS NOT NULL.
-- - Operaciones destructivas: NINGUNA. Sin DELETE / UPDATE / TRUNCATE / DROP /
--   CASCADE.
-- - FK/cascade risk: sin FK a propósito. store_id lo filtra StorePrismaService;
--   source_conversation_id apunta a una conversación que puede borrarse de
--   verdad (F1 · T4) y el borrado de sus recuerdos no editados lo hace la
--   aplicación, fila por fila, nunca un ON DELETE CASCADE.
-- - Idempotencia: CREATE TABLE / INDEX IF NOT EXISTS.
-- - Reversibilidad: DROP TABLE solo si está vacía; con datos, renombrar a
--   ai_agent_memories_deprecated_YYYYMMDD.
-- - Plan: odd/tasks/vex-agente-avanzado.md, §3.3 y §3.9 (M6), tarea T31.
-- =====================================================

CREATE TABLE IF NOT EXISTS "ai_agent_memories" (
  "id" SERIAL NOT NULL,
  "store_id" INTEGER NOT NULL,
  "organization_id" INTEGER NOT NULL,
  "agent_key" VARCHAR(80) NOT NULL DEFAULT 'vex',
  "user_id" INTEGER,
  "key" VARCHAR(120) NOT NULL,
  "content" VARCHAR(500) NOT NULL,
  "kind" VARCHAR(20) NOT NULL DEFAULT 'preference',
  "origin" VARCHAR(20) NOT NULL DEFAULT 'agent',
  "source_conversation_id" INTEGER,
  "created_by_user_id" INTEGER,
  "updated_by_user_id" INTEGER,
  "last_used_at" TIMESTAMP(6),
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_agent_memories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_agent_memories_store_id_agent_key_idx"
  ON "ai_agent_memories" ("store_id", "agent_key");

CREATE INDEX IF NOT EXISTS "ai_agent_memories_source_conversation_id_idx"
  ON "ai_agent_memories" ("source_conversation_id");

CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_memories_store_scope_key_uq"
  ON "ai_agent_memories" ("store_id", "agent_key", "key")
  WHERE "user_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_memories_user_scope_key_uq"
  ON "ai_agent_memories" ("store_id", "agent_key", "user_id", "key")
  WHERE "user_id" IS NOT NULL;
