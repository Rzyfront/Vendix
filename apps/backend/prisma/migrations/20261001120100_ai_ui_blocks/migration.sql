-- =====================================================
-- Vex: tabla de bloques UI manipulables
-- =====================================================
-- DATA IMPACT: 0 filas modificadas; 0 filas insertadas (tabla nueva, vacía)
-- - Tablas afectadas: ai_ui_blocks (nueva, vacía)
-- - Expected row changes: 0 (solo CREATE TABLE + índices; ninguna fila mutada)
-- - Destructive operations: none (sin CASCADE / DROP / DELETE / UPDATE)
-- - FK/cascade risk: none (tabla sin FKs entrantes ni salientes; `store_id`,
--   `conversation_id` y `message_id` se resuelven por servicio con scope de
--   tienda, como `ai_attachments`, para no encadenar borrados)
-- - Idempotency: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS —
--   re-ejecutable sin error
-- - Approval: plan docs/plans/vex-agent-plan.md, paso 7 (DDL adelantado al
--   paso 1 para que el modelo Prisma exista antes que los servicios)
-- - Reversibility: DROP TABLE IF EXISTS "ai_ui_blocks";
-- =====================================================

CREATE TABLE IF NOT EXISTS "ai_ui_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" INTEGER NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "message_id" INTEGER,
    "kind" VARCHAR(20) NOT NULL,
    "spec" JSONB,
    "data" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_ui_blocks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_ui_blocks_store_id_idx" ON "ai_ui_blocks"("store_id");

CREATE INDEX IF NOT EXISTS "ai_ui_blocks_conversation_id_idx" ON "ai_ui_blocks"("conversation_id");

CREATE INDEX IF NOT EXISTS "ai_ui_blocks_store_id_conversation_id_idx" ON "ai_ui_blocks"("store_id", "conversation_id");
