-- DATA IMPACT:
-- Tables affected: ai_agents (nueva, vacía)
-- Expected row changes: 0 (solo CREATE TABLE + índices; ninguna fila mutada;
--   la fila seed `vexi` la inserta el seed `ai-agents.seed.ts`, no esta migración)
-- Destructive operations: none (sin CASCADE / DROP / DELETE / UPDATE)
-- FK/cascade risk: none (tabla sin FKs entrantes ni salientes; `app_key` se
--   valida en servicio, no con FK, para no bloquear el borrado de apps)
-- Idempotency: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS —
--   re-ejecutable sin error
-- Approval: plan PLAN-ia-engine-centralizacion-planes-tenants.md, paso F4
-- Reversibility: DROP TABLE IF EXISTS "ai_agents";

-- F4 — catálogo configurable de agentes. Vexi es la fila `key = 'vexi'`;
-- crear un segundo agente es insertar una fila, sin deploy.
CREATE TABLE IF NOT EXISTS "ai_agents" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "app_key" VARCHAR(100),
    "system_prompt" TEXT,
    "allowed_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "max_iterations" INTEGER,
    "requires_confirmation_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_agents_key_key" ON "ai_agents"("key");

CREATE INDEX IF NOT EXISTS "ai_agents_is_active_idx" ON "ai_agents"("is_active");

CREATE INDEX IF NOT EXISTS "ai_agents_app_key_idx" ON "ai_agents"("app_key");
