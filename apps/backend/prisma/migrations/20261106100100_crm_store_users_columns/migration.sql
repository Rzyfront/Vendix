-- CRM · M2 (PLAN-CRM §2.2, §3): atributos comerciales por tienda en store_users.
--
-- DATA IMPACT:
--   Tables affected: store_users (8 columnas nuevas, 4 índices, 1 FK).
--   Expected row changes: 0. No DML. Columnas nulas o con default constante
--   ('unknown'): en PG >= 11 el default constante es metadata-only, sin
--   reescritura de la tabla. Sin backfill de crm_source ni de responsables.
--   Destructive operations: ninguna. Sin DROP, UPDATE, DELETE ni CASCADE.
--   FK/cascade risk: crm_owner_user_id -> users ON DELETE SET NULL (borrar un
--   usuario solo deja al cliente sin responsable). La FK crm_stage_id ->
--   crm_pipeline_stages se crea en M3, cuando la tabla existe.
--   Locks: CREATE INDEX (no CONCURRENTLY, Prisma corre en transacción) bloquea
--   escrituras en store_users mientras se construye; tabla de tamaño moderado.
--   Idempotency: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS y FK
--   protegida con pg_constraint.
--   Approval: PLAN-CRM PR 1, decisiones de Rafael (2026-10-31).

-- Columnas
ALTER TABLE "store_users" ADD COLUMN IF NOT EXISTS "consent_updated_at" TIMESTAMP(6);
ALTER TABLE "store_users" ADD COLUMN IF NOT EXISTS "crm_last_contact_at" TIMESTAMP(6);
ALTER TABLE "store_users" ADD COLUMN IF NOT EXISTS "crm_owner_user_id" INTEGER;
ALTER TABLE "store_users" ADD COLUMN IF NOT EXISTS "crm_source" VARCHAR(40);
ALTER TABLE "store_users" ADD COLUMN IF NOT EXISTS "crm_stage_id" INTEGER;
ALTER TABLE "store_users" ADD COLUMN IF NOT EXISTS "email_consent" "crm_contact_consent_enum" NOT NULL DEFAULT 'unknown';
ALTER TABLE "store_users" ADD COLUMN IF NOT EXISTS "sms_consent" "crm_contact_consent_enum" NOT NULL DEFAULT 'unknown';
ALTER TABLE "store_users" ADD COLUMN IF NOT EXISTS "whatsapp_consent" "crm_contact_consent_enum" NOT NULL DEFAULT 'unknown';

-- Índices
CREATE INDEX IF NOT EXISTS "store_users_store_id_crm_owner_user_id_idx" ON "store_users"("store_id", "crm_owner_user_id");
CREATE INDEX IF NOT EXISTS "store_users_store_id_crm_source_idx" ON "store_users"("store_id", "crm_source");
CREATE INDEX IF NOT EXISTS "store_users_store_id_crm_stage_id_idx" ON "store_users"("store_id", "crm_stage_id");
CREATE INDEX IF NOT EXISTS "store_users_store_id_crm_last_contact_at_idx" ON "store_users"("store_id", "crm_last_contact_at");

-- FK responsable
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_users_crm_owner_user_id_fkey') THEN
    ALTER TABLE "store_users" ADD CONSTRAINT "store_users_crm_owner_user_id_fkey" FOREIGN KEY ("crm_owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
