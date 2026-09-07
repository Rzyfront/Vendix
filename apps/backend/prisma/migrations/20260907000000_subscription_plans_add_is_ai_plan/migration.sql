-- Paso 1 PLAN-plan-ia-card-brillante: marcar un plan como "plan IA" con brillo IA.
-- Columna nueva `subscription_plans.is_ai_plan` (boolean, NOT NULL, DEFAULT false).
--
-- DATA IMPACT: ninguna fila modificada; añade columna con default
-- Tables affected: subscription_plans — 1 columna AGREGADA (`is_ai_plan`, NOT NULL, DEFAULT false)
-- Expected row changes: 0 filas mutadas. Toda fila existente queda con `is_ai_plan = false`
--   (relleno por DEFAULT de Postgres al añadir columna NOT NULL con DEFAULT; sin UPDATE explicito).
-- Destructive operations: NINGUNA. Sin DROP, sin TRUNCATE, sin CASCADE, sin DELETE, sin UPDATE.
-- FK/cascade risk: ninguno (columna escalar sin FK ni indice nuevo).
-- Idempotency: ADD COLUMN con IF NOT EXISTS. Reejecutable.
-- Approval: PLAN-plan-ia-card-brillante paso 1.
-- Rollback: DROP COLUMN is_ai_plan solo si ningun codigo la lee/escribe aun (paso 1, sin consumidores).

ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "is_ai_plan" BOOLEAN NOT NULL DEFAULT false;
