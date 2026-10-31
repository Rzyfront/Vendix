-- CRM PR 10 (PLAN-CRM §4.7): variables de la plantilla de WhatsApp de una
-- campaña y asunto de cada correo enviado.
--
-- DATA IMPACT:
-- Tables affected: crm_campaigns, crm_messages (schema only)
-- Expected row changes: none (nullable columns, no default, no backfill)
-- Destructive operations: none
-- FK/cascade risk: none
-- Idempotency: ADD COLUMN IF NOT EXISTS
-- Approval: schema-only additive change, no row mutation

ALTER TABLE "crm_campaigns" ADD COLUMN IF NOT EXISTS "template_variables" JSONB;
ALTER TABLE "crm_messages" ADD COLUMN IF NOT EXISTS "subject" VARCHAR(200);
