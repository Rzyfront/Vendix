-- CRM · PR 6 (PLAN-CRM §2.4, §5.2): tope mensual de gasto de SMS por tienda.
--
-- DATA IMPACT:
--   Tables affected: social_channels (3 columnas nuevas); tipo
--   notification_type_enum (1 valor nuevo).
--   Expected row changes: 0. No DML. monthly_spend_limit y spend_period_start
--   son nulas; monthly_spend_used tiene default constante 0 (metadata-only en
--   PG >= 11, sin reescritura).
--   Destructive operations: ninguna. Sin DROP, UPDATE, DELETE ni CASCADE.
--   FK/cascade risk: ninguno, no se crean FKs.
--   Idempotency: ADD COLUMN IF NOT EXISTS y ADD VALUE IF NOT EXISTS. El valor
--   nuevo del enum no se usa en esta misma migración.
--   Approval: PLAN-CRM PR 6, decisión 3 de Rafael (tope duro por tienda).

ALTER TYPE "notification_type_enum" ADD VALUE IF NOT EXISTS 'crm_sms_spend_limit_reached';

ALTER TABLE "social_channels" ADD COLUMN IF NOT EXISTS "monthly_spend_limit" DECIMAL(12,2);
ALTER TABLE "social_channels" ADD COLUMN IF NOT EXISTS "monthly_spend_used" DECIMAL(12,4) NOT NULL DEFAULT 0;
ALTER TABLE "social_channels" ADD COLUMN IF NOT EXISTS "spend_period_start" DATE;
