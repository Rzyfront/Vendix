-- QUI-1043 — CRM pipeline: stage templates, CRM default data-collection
-- template and per-customer data sheet template.
--
-- DATA IMPACT:
--   Tables affected:
--     crm_stage_templates (NEW): reusable stage lists for CRM pipelines.
--     data_collection_templates: new column is_crm_default BOOLEAN NOT NULL
--       DEFAULT false (metadata-only add, no table rewrite) + partial unique
--       index "one CRM default per store".
--     store_users: new nullable column crm_data_template_id + index + FK.
--   Expected row changes: 0. No DML (no INSERT/UPDATE/DELETE).
--   Destructive operations: none. No DROP, no TRUNCATE.
--   FK/cascade risk: none. crm_stage_templates.store_id -> stores ON DELETE
--     RESTRICT; store_users.crm_data_template_id -> data_collection_templates
--     ON DELETE SET NULL (deleting a template only clears the customer's
--     choice, the customer falls back to the CRM default). No CASCADE.
--   Idempotency: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS
--     and FKs guarded with pg_constraint. Running it twice is a no-op.
--   Approval: additive schema requested in the QUI-1043 brief (Rafael).

-- 1. Stage templates.
CREATE TABLE IF NOT EXISTS "crm_stage_templates" (
    "id" SERIAL NOT NULL,
    "store_id" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "stages" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_stage_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_stage_templates_store_id_name_key"
    ON "crm_stage_templates"("store_id", "name");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_stage_templates_store_id_fkey') THEN
    ALTER TABLE "crm_stage_templates" ADD CONSTRAINT "crm_stage_templates_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

-- 2. CRM default data-collection template (one per store).
ALTER TABLE "data_collection_templates"
    ADD COLUMN IF NOT EXISTS "is_crm_default" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "data_collection_templates_one_crm_default_per_store"
    ON "data_collection_templates"("store_id") WHERE "is_crm_default";

-- 3. Data sheet template chosen for a customer of the store.
ALTER TABLE "store_users"
    ADD COLUMN IF NOT EXISTS "crm_data_template_id" INTEGER;

CREATE INDEX IF NOT EXISTS "store_users_crm_data_template_id_idx"
    ON "store_users"("crm_data_template_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_users_crm_data_template_id_fkey') THEN
    ALTER TABLE "store_users" ADD CONSTRAINT "store_users_crm_data_template_id_fkey" FOREIGN KEY ("crm_data_template_id") REFERENCES "data_collection_templates"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
