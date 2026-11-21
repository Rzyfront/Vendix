-- Derechos de IA por plan (odd/tasks/vex-agente-avanzado.md §3.11, T9, M2).
--
-- Qué hace:
--   1. Crea el enum ai_entitlement_on_limit_enum ('block', 'warn').
--   2. Crea la tabla plan_ai_entitlements (plan_id, agent_key, capability_key,
--      enabled, cap_value, on_limit) con único (plan_id, agent_key,
--      capability_key), índice por (agent_key, capability_key) y FK a
--      subscription_plans con ON DELETE RESTRICT.
--   cap_value es BIGINT porque los topes de tokens de los planes comerciales
--   llegan a 20 000 M (plan-commercial-lines.seed.ts) y no caben en INTEGER.
--   NULL = sin límite; 0 = nada.
--
-- Efecto en producción: ninguno. La tabla nace vacía; la copia de los planes
-- existentes va en la migración siguiente (M3, T11) y el gate sigue decidiendo
-- con subscription_plans.ai_feature_flags (modo sombra, T10).
--
-- DATA IMPACT:
--   Tables affected: plan_ai_entitlements (tabla nueva). Ninguna tabla
--     existente cambia filas ni columnas.
--   Expected row changes: 0.
--   Destructive operations: ninguna. Sin DELETE, DROP, TRUNCATE ni UPDATE.
--   FK/cascade risk: FK nueva plan_ai_entitlements.plan_id → subscription_plans
--     con ON DELETE RESTRICT (sin cascada sobre datos de negocio). Borrar un
--     plan exige borrar antes sus filas, igual que plan_module_rules
--     (plans.service.ts lo hace en la misma transacción).
--   Idempotency: tipo con pg_type, tabla e índices con IF NOT EXISTS, FK con
--     pg_constraint.
--   Reversa: la tabla no tiene lector que decida acceso mientras dure el modo
--     sombra. Para retirarla, renombrar a plan_ai_entitlements_deprecated_YYYYMMDD
--     en una migración nueva; nunca DROP directo.
--   Approval: plan Vex Plus aprobado por Rafael (encargo F2, 2026-11-20):
--     "Migraciones Prisma (M2, M3): solo aditivas, con cabecera DATA IMPACT
--     honesta, idempotentes".

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_entitlement_on_limit_enum') THEN
    CREATE TYPE "ai_entitlement_on_limit_enum" AS ENUM ('block', 'warn');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "plan_ai_entitlements" (
    "id" SERIAL NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "agent_key" VARCHAR(16) NOT NULL,
    "capability_key" VARCHAR(64) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "cap_value" BIGINT,
    "on_limit" "ai_entitlement_on_limit_enum" NOT NULL DEFAULT 'block',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_ai_entitlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "plan_ai_entitlements_plan_id_agent_key_capability_key_key"
  ON "plan_ai_entitlements"("plan_id", "agent_key", "capability_key");

CREATE INDEX IF NOT EXISTS "plan_ai_entitlements_agent_key_capability_key_idx"
  ON "plan_ai_entitlements"("agent_key", "capability_key");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'plan_ai_entitlements_plan_id_fkey'
  ) THEN
    ALTER TABLE "plan_ai_entitlements"
      ADD CONSTRAINT "plan_ai_entitlements_plan_id_fkey"
      FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
